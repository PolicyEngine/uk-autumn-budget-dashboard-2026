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
 * changes its net income in a year the page offers (ea665c3 lists which).
 * The description and note describe the household, never a measure: which
 * measures change its income is the calculation's answer, and the published
 * measures can change, so a name there could name one the page no longer
 * shows (#104).
 */
import { EXAMPLE_ANSWERS } from "./exampleAnswers";
import { decileSpending, spendingInputs } from "./exampleSpending";
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
      // Electricity, petrol and diesel: the averages for its tenth by gross
      // income (£255 a week in 2027-28), ONS Family Spending FYE
      // 2025, Table A6 (exampleSpending.js)
      ...spendingInputs(1),
    },
    note: "Aged 70 with the full new State Pension and no other income; owns their home outright. Spends £760 a year on electricity and £320 on petrol and diesel, the average for households in the lowest tenth by gross income (ONS Family Spending, FYE 2025).",
    // The spending's source, in the result's "Based on"
    spendingSource: decileSpending(1).source,
  },
  {
    id: "family-uc",
    label: "A family on Universal Credit",
    // On its chip once the cards fold into a strip
    short: "Universal Credit family",
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
      // Electricity, petrol and diesel: the averages for its tenth by gross
      // income (£814 a week in 2027-28), ONS Family Spending FYE
      // 2025, Table A6 (exampleSpending.js)
      ...spendingInputs(5),
    },
    note: "A couple renting privately at £975 a month with children aged 7 and 4; one earns £21,000, the other has no earnings. Claims the Universal Credit they are due. Spends £1,060 a year on electricity and £970 on petrol and diesel, the average for households in the fifth tenth by gross income (ONS Family Spending, FYE 2025).",
    // The spending's source, in the result's "Based on"
    spendingSource: decileSpending(5).source,
  },
  {
    id: "graduate-35k",
    label: "A graduate on £35,000",
    // On its chip once the cards fold into a strip
    short: "Graduate",
    description: "Aged 27, Plan 2 student loan, renting",
    icon: "graduate",
    measure: "plan_2_threshold_unfreeze",
    tag: "Student loan threshold",
    inputs: {
      ...RESET,
      current_age: 27,
      current_salary: 35000,
      student_loan_plan: "PLAN_2",
      tenure: "RENT_PRIVATELY",
      // Fixed: the North West's average private rent (ONS, September 2026)
      monthly_rent: 975,
      // Electricity, petrol and diesel: the averages for its tenth by gross
      // income (£689 a week in 2027-28), ONS Family Spending FYE
      // 2025, Table A6 (exampleSpending.js)
      ...spendingInputs(4),
    },
    note: "Aged 27, earns £35,000 and repays a Plan 2 student loan; rents privately at £975 a month, the North West's average. Spends £1,010 a year on electricity and £910 on petrol and diesel, the average for households in the fourth tenth by gross income (ONS Family Spending, FYE 2025).",
    // The spending's source, in the result's "Based on"
    spendingSource: decileSpending(4).source,
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
      // Electricity: the average for its tenth by gross income (748
      // a week in 2027-28), ONS Family Spending FYE 2025, Table A6
      // (exampleSpending.js); its petrol is its own, above
      electricity_spending_per_year: decileSpending(4).electricity,
    },
    note: "Aged 40, earns £38,000 and spends £2,600 a year on petrol, about four times the average household; owns with a mortgage. Spends £1,010 a year on electricity, the average for households in the fourth tenth by gross income (ONS Family Spending, FYE 2025).",
    // The spending's source, in the result's "Based on"
    spendingSource: `Petrol: its own, about four times the average household. Electricity: ${decileSpending(4).source.charAt(0).toLowerCase()}${decileSpending(4).source.slice(1)}`,
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
      // Electricity, petrol and diesel: the averages for its tenth by gross
      // income (£2,166 a week in 2027-28), ONS Family Spending FYE
      // 2025, Table A6 (exampleSpending.js)
      ...spendingInputs(9),
    },
    note: "Aged 45, earns £110,000 and owns with a mortgage. Spends £1,170 a year on electricity and £1,320 on petrol and diesel, the average for households in the ninth tenth by gross income (ONS Family Spending, FYE 2025).",
    // The spending's source, in the result's "Based on"
    spendingSource: decileSpending(9).source,
  },
  {
    id: "lone-parent",
    label: "A lone parent working part time",
    // On its chip once the cards fold into a strip
    short: "Lone parent",
    description: "One child aged 4, £14,000 part time, renting",
    icon: "baby",
    measure: "domestic_electricity_zero_vat",
    tag: "Zero VAT on electricity",
    inputs: {
      ...RESET,
      // The average age at a first birth (29.4 in 2024: ONS, Births in
      // England and Wales) plus the child's four years
      current_age: 33,
      // About 21 hours a week at the National Living Wage from April 2026
      // (£12.71 an hour, GOV.UK), a little below the median for part-time
      // employees (£280 a week in April 2025, £14,560 a year: ONS ASHE 2025)
      current_salary: 14000,
      has_partner: false,
      children_ages: "4",
      tenure: "RENT_PRIVATELY",
      // Fixed: the North West's average private rent (ONS, September 2026)
      monthly_rent: 975,
      claims_universal_credit: true,
      // In a reception class, so childcare in the school holidays: about 13
      // weeks a year at England's average holiday club price, £190 a week
      // (Coram Family and Childcare, Holiday Childcare Survey 2026), £2,470
      // a year, about £205 a month. Universal Credit pays back up to 85% of
      // it (DWP)
      monthly_childcare: 205,
      // Electricity, petrol and diesel: the averages for its tenth by gross
      // income (£627 a week in 2027-28), ONS Family Spending FYE
      // 2025, Table A6 (exampleSpending.js)
      ...spendingInputs(4),
    },
    note: "Aged 33 with one child aged 4, renting privately at £975 a month. Earns £14,000 working part time, about 21 hours a week at the 2026 National Living Wage, a little below the median for part-time employees (ONS ASHE 2025). Their child is in a reception class; childcare in the school holidays, about 13 weeks a year at England's average holiday club price (Coram, 2026), comes to about £205 a month. Claims the Universal Credit they are due, which pays back up to 85% of childcare costs. Spends £1,010 a year on electricity and £910 on petrol and diesel, the average for households in the fourth tenth by gross income (ONS Family Spending, FYE 2025).",
    // The spending's source, in the result's "Based on"
    spendingSource: decileSpending(4).source,
  },
];

/** Every example, in the cards' order. */
export const HOUSEHOLD_EXAMPLES = [...YOUNG_PERSON_PRESETS, ...OTHER_HOUSEHOLD_EXAMPLES];
