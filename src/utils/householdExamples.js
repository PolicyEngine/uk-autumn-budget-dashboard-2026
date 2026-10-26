/**
 * The example households, as cards beside "Your household" on the
 * Household impact view: two young people (youngPersonPresets.js), then
 * other households. Each has a name, a one-line description of who they
 * are, the measure its card features (`measure`, which gives the card its
 * colour, and `tag`, its short name on the card; shown only while the
 * catalogue publishes that measure, #104) and an icon (named in
 * personal/HouseholdCards.jsx). An example fills every answer of the form
 * (exampleAnswers.js, never the form's defaults) and shows its result at
 * once; every value stays editable.
 *
 * Each "Other households" example was chosen, and checked against the live
 * household API on 25 October 2026, so that a measure then published
 * changes its net income in a year the page offers (9105ef7 lists which).
 * The description and note describe the household, never a measure: which
 * measures change its income is the calculation's answer, and the published
 * measures can change, so a name there could name one the page no longer
 * shows (#104).
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
    // On its chip once the cards fold into a strip
    short: "Pensioner",
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
    // On its chip once the cards fold into a strip
    short: "UC family",
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
    note: "A couple renting privately at £975 a month with children aged 7 and 4; one earns £21,000, the other has no earnings. Claims the Universal Credit they are due. Spends £1,300 a year on electricity, above the average household.",
  },
  {
    id: "graduate-35k",
    label: "A graduate on £35,000",
    // On its chip once the cards fold into a strip
    short: "Graduate",
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
    // On its chip once the cards fold into a strip
    short: "Commuter",
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
    // On its chip once the cards fold into a strip
    short: "High earner",
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
    note: "Aged 45, earns £110,000 and owns with a mortgage.",
  },
];

/** Every example, in the cards' order. */
export const HOUSEHOLD_EXAMPLES = [...YOUNG_PERSON_PRESETS, ...OTHER_HOUSEHOLD_EXAMPLES];
