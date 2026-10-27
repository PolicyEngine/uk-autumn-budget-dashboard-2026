/**
 * The example households, as cards beside "Your household" on the
 * Household impact view. Each has a name, a one-line description of who they
 * are, the measure its card features (`measure`, which gives the card its
 * colour, and `tag`, its short name on the card; shown only while the
 * catalogue publishes that measure, #104) and an icon (named in
 * personal/HouseholdCards.jsx). An example fills every answer of the form
 * (exampleAnswers.js, never the form's defaults) and shows its result at
 * once; every value stays editable.
 *
 * The eight were chosen for the ten candidate measures (PR #261), and each
 * checked against the household test API running candidates-ten on 27
 * October 2026 (include by_policy), so that the measure its card features
 * changes its net income in a year the page offers: 2027-28, or 2031-32
 * for the threshold freeze. Two candidates have no example: the Carer's
 * Allowance taper (the form asks for no caring hours) and the Warm Home
 * Discount top-up (paid in 2026-27, before the examples' first year).
 * The description and note describe the household, never a measure: which
 * measures change its income is the calculation's answer, and the published
 * measures can change, so a name there could name one the page no longer
 * shows (#104).
 */
import { EXAMPLE_ANSWERS } from "./exampleAnswers";
import { decileSpending, spendingInputs } from "./exampleSpending";

// Every example starts from every answer fixed (exampleAnswers.js): no
// other income, no salary sacrifice, no childcare and no children, and a
// fixed region, rent, council tax band and spending. Never the form's
// defaults or a prefill, so its request, and its precomputed result, stay
// the same whatever the defaults become; and an earlier example's answers
// never linger
const RESET = EXAMPLE_ANSWERS;

const own = (what, decile) => `${what}. ${decileSpending(decile).source.charAt(0).toUpperCase()}${decileSpending(decile).source.slice(1)}`;

export const HOUSEHOLD_EXAMPLES = [
  {
    id: "pensioner-70",
    label: "A pensioner with a small private pension",
    // On its chip once the cards fold into a strip
    short: "Pensioner",
    description: "Aged 70, £11,500 State Pension plus £1,300 private",
    icon: "armchair",
    measure: "state_pension_income_tax_protection",
    tag: "State Pension protection",
    inputs: {
      ...RESET,
      current_age: 70,
      current_salary: 0,
      tenure: "OWNED_OUTRIGHT",
      // Less than the full new State Pension (an incomplete record), with
      // a small workplace pension: £12,800 in all, above the personal
      // allowance and below the full new State Pension in 2027-28
      state_pension_per_year: 11500,
      private_pension_per_year: 1300,
      ...spendingInputs(1),
    },
    note: "Aged 70, owns their home outright. Gets £11,500 a year of State Pension, less than the full amount, and £1,300 from a workplace pension: £12,800 in all. Spends £760 a year on electricity and £320 on petrol and diesel, the average for households in the lowest tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(1).source,
  },
  {
    id: "renter-london",
    label: "A London renter on Universal Credit",
    short: "London renter",
    description: "£15,000, renting at £1,600 a month, no car",
    icon: "key",
    measure: "lha_unfreeze_2027",
    tag: "Housing allowance",
    inputs: {
      ...RESET,
      current_age: 35,
      current_salary: 15000,
      region: "LONDON",
      tenure: "RENT_PRIVATELY",
      // Illustrative: a one-bedroom flat, below London's average private
      // rent (£2,338, ONS, September 2026)
      monthly_rent: 1600,
      claims_universal_credit: true,
      ...spendingInputs(3),
      petrol_spending_per_year: 0,
      diesel_spending_per_year: 0,
    },
    note: "Aged 35, single, earns £15,000 and rents privately in London at £1,600 a month, an illustrative figure below London's average (ONS, September 2026). Claims the Universal Credit they are due; earns enough not to be affected by the benefit cap. No car. Spends £910 a year on electricity, the average for households in the third tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: own("No petrol or diesel: no car. Electricity", 3),
  },
  {
    id: "graduate-35k",
    label: "A graduate on £35,000",
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
      ...spendingInputs(4),
    },
    note: "Aged 27, earns £35,000 and repays a Plan 2 student loan; rents privately at £975 a month, the North West's average. Spends £1,010 a year on electricity and £910 on petrol and diesel, the average for households in the fourth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(4).source,
  },
  {
    id: "driver",
    label: "A driver with a long commute",
    short: "Commuter",
    description: "£38,000, rural South West, £2,600 a year on fuel",
    icon: "car",
    measure: "fuel_duty_rise_deferral",
    tag: "Fuel duty",
    inputs: {
      ...RESET,
      current_age: 40,
      current_salary: 38000,
      region: "SOUTH_WEST",
      tenure: "OWNED_WITH_MORTGAGE",
      petrol_spending_per_year: 1300,
      diesel_spending_per_year: 1300,
      electricity_spending_per_year: decileSpending(4).electricity,
    },
    note: "Aged 40, earns £38,000 and lives in the rural South West, owning with a mortgage. Two cars, one petrol and one diesel: £2,600 a year on fuel, about three times the average household. Spends £1,010 a year on electricity, the average for households in the fourth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: own("Petrol and diesel: its own, about three times the average household. Electricity", 4),
  },
  {
    id: "family-uc",
    label: "A family with high electricity use",
    short: "Universal Credit family",
    description: "A couple with two children, renting, on £21,000",
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
      ...spendingInputs(5),
      // An all-electric home: its own figure, about 1.7 times its tenth's
      electricity_spending_per_year: 1800,
    },
    note: "A couple renting privately at £975 a month with children aged 7 and 4; one earns £21,000, the other has no earnings. Claims the Universal Credit they are due. An all-electric home: spends £1,800 a year on electricity, and £970 on petrol and diesel, the average for households in the fifth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: own("Electricity: its own, an all-electric home. Petrol and diesel", 5),
  },
  {
    id: "landlord-saver",
    label: "A landlord with savings",
    short: "Landlord",
    description: "£50,000 salary, rent from a flat, dividends, interest",
    icon: "briefcase",
    measure: "unearned_income_rates_up",
    tag: "Unearned income rates",
    inputs: {
      ...RESET,
      current_age: 55,
      current_salary: 50000,
      tenure: "OWNED_OUTRIGHT",
      property_income_per_year: 9000,
      dividends_per_year: 3000,
      savings_interest_per_year: 2000,
      ...spendingInputs(8),
    },
    note: "Aged 55, earns £50,000 and owns their home outright. Lets a flat for £9,000 a year after costs, and gets £3,000 of dividends and £2,000 of savings interest. Spends £1,120 a year on electricity and £1,350 on petrol and diesel, the average for households in the eighth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(8).source,
  },
  {
    id: "middle-earner",
    label: "A middle earner on £45,000",
    short: "Middle earner",
    description: "Aged 40, owns their home with a mortgage",
    icon: "hardHat",
    measure: "threshold_freeze_2031_32",
    tag: "Threshold freeze, 2031-32",
    inputs: {
      ...RESET,
      current_age: 40,
      current_salary: 45000,
      tenure: "OWNED_WITH_MORTGAGE",
      ...spendingInputs(7),
    },
    note: "Aged 40, earns £45,000 and owns with a mortgage. Spends £1,080 a year on electricity and £1,200 on petrol and diesel, the average for households in the seventh tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(7).source,
  },
  {
    id: "lone-parent",
    label: "A lone parent working part time",
    // On its chip once the cards fold into a strip
    short: "Lone parent",
    description: "One child aged 4, £14,000 part time, renting",
    icon: "baby",
    measure: "employer_nics_secondary_threshold_raise",
    tag: "Employer NI threshold",
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
