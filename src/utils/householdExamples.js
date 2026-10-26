/**
 * The example households, as cards beside "Your household" on the
 * Household impact view: two young people (youngPersonPresets.js), then
 * other households, each chosen to show one measure clearly. Each has a
 * name, a one-line description of who they are, the measure it is for
 * (`measure`, which gives the card its colour, and `tag`, its short name
 * on the card) and an icon (named in personal/HouseholdCards.jsx). An
 * example fills every answer of the form (exampleAnswers.js, never the
 * form's defaults) and shows its result at once; every value stays
 * editable.
 *
 * Each example after the young people was checked against the live household
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
import { EXAMPLE_ANSWERS } from "./exampleAnswers";
import { YOUNG_PERSON_PRESETS } from "./youngPersonPresets";

// Every example starts from every answer fixed (exampleAnswers.js): no
// other income, no salary sacrifice, no childcare and no children, and a
// fixed region, rent, council tax band and spending. Never the form's
// defaults or a prefill, so its request, and its precomputed result, stay
// the same whatever the defaults become; and an earlier example's answers
// never linger
const RESET = EXAMPLE_ANSWERS;

export const OTHER_HOUSEHOLD_EXAMPLES = [
  {
    id: "pensioner-70",
    label: "A pensioner on the State Pension",
    description: "Aged 70, State Pension only, owns their home",
    icon: "armchair",
    measure: "state_pension_income_tax_protection",
    tag: "State Pension protection",
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
    description: "A couple with two children, renting",
    icon: "family",
    measure: "domestic_electricity_zero_vat",
    tag: "Zero VAT on electricity",
    inputs: {
      ...RESET,
      current_age: 34,
      current_salary: 21000,
      has_partner: true,
      partner_age: 33,
      partner_salary: 0,
      children_ages: "7, 4",
      tenure: "RENT_PRIVATELY",
      // Fixed: the North West's average private rent (ONS, September 2026)
      monthly_rent: 975,
      electricity_spending_per_year: 1300,
    },
    note: "A couple renting privately at £975 a month with children aged 7 and 4; one earns £21,000, the other has no earnings. Claims the Universal Credit they are due. Spends £1,300 a year on electricity, above the average household. The Warm Home Discount top-up is for winter 2026-27 only, before the years offered here.",
  },
  {
    id: "graduate-35k",
    label: "A graduate on £35,000",
    description: "Aged 27, Plan 2 student loan, renting",
    icon: "graduate",
    measure: "plan_2_threshold_unfreeze",
    tag: "Plan 2 threshold unfrozen",
    inputs: {
      ...RESET,
      current_age: 27,
      current_salary: 35000,
      student_loan_plan: "PLAN_2",
      tenure: "RENT_PRIVATELY",
      // Fixed: the North West's average private rent (ONS, September 2026)
      monthly_rent: 975,
    },
    note: "Aged 27, earns £35,000 and repays a Plan 2 student loan; rents privately at £975 a month, the North West's average.",
  },
  {
    id: "driver",
    label: "A driver with a long commute",
    description: "£38,000, spends £2,600 a year on petrol",
    icon: "car",
    measure: "fuel_duty_rise_deferral",
    // The tag covers both fuel measures, and its figure is their parts
    measures: ["fuel_duty_rise_deferral", "road_fuel_vat_cut"],
    tag: "Fuel duty and fuel VAT",
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
    description: "Aged 45, owns their home with a mortgage",
    icon: "briefcase",
    measure: "threshold_freeze_2031_32",
    tag: "Threshold freeze, 2031-32",
    inputs: {
      ...RESET,
      current_age: 45,
      current_salary: 110000,
      tenure: "OWNED_WITH_MORTGAGE",
    },
    note: "Aged 45, earns £110,000 and owns with a mortgage. The threshold freeze extension changes their income tax from 2031-32: choose that year to see it.",
  },
];

/** Every example, in the cards' order. */
export const HOUSEHOLD_EXAMPLES = [...YOUNG_PERSON_PRESETS, ...OTHER_HOUSEHOLD_EXAMPLES];
