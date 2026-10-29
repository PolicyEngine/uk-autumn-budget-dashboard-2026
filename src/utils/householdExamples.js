/**
 * The example households, as cards beside "Your household" on the
 * Household calculator view. Each has a name, a one-line description of who they
 * are, the measure its card features (`measure`, which gives the card its
 * colour, and `tag`, its short name on the card; shown only while the
 * catalogue publishes that measure, #104) and an icon (named in
 * personal/HouseholdCards.jsx). An example fills every answer of the form
 * (exampleAnswers.js, never the form's defaults) and shows its result at
 * once; every value stays editable.
 *
 * The eight were chosen for the candidate measures before the Budget
 * (PR #261) and checked against the household test API on 27 October
 * 2026. The Warm Home Discount top-up had no example: it is paid in
 * 2026-27, before the examples' first year.
 *
 * Budget day (28 October 2026, #287): examples whose measure is not in the
 * Budget give their place to announced measures. The pensioner on
 * the full new State Pension takes the part-time worker's (the employer NI
 * threshold): with a little private pension, their income is just above
 * the full new State Pension, where the Pension Tax Allowance tapers away
 * (£1 for every £3 above it: HM Treasury's explainer), beside the pensioner
 * at 70, whose income is below it. The carer takes the graduate's (the Plan
 * 2 threshold): they earn a little above Carer's Allowance's weekly
 * earnings limit, so are not entitled to it before the Budget's taper, which
 * begins within 2030-31; their partner's earnings leave the couple no
 * Universal Credit, which would otherwise offset the allowance. A middle
 * earner who lets a flat takes the middle earner's (the threshold freeze
 * to 2031-32): the household in PolicyEngine's post on the savings and
 * property income rates whose property income takes its savings interest
 * into the higher-rate band, beside the landlord, whose salary is already
 * there.
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
    tag: "Pension Tax Allowance",
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
    id: "pensioner-full-state-pension",
    label: "A pensioner on the full State Pension",
    short: "Full State Pension",
    description: "Aged 68, full new State Pension plus £150 private",
    icon: "glasses",
    measure: "state_pension_income_tax_protection",
    tag: "Pension Tax Allowance",
    inputs: {
      ...RESET,
      current_age: 68,
      current_salary: 0,
      tenure: "OWNED_OUTRIGHT",
      // The full new State Pension (state_pension_per_year left null: the
      // API reads the model's rate for the year, £13,036.40 in 2027-28 in
      // HM Treasury's Pension Tax Allowance explainer, 28 October 2026)
      // and a small workplace pension: £150 a year above the full new
      // State Pension, the explainer's own case of £13,186.40, so its
      // total income is just above the full new State Pension in every
      // year
      private_pension_per_year: 150,
      ...spendingInputs(1),
    },
    note: "Aged 68, owns their home outright. Gets the full new State Pension, £13,036.40 a year in 2027-28 (HM Treasury, October 2026), and £150 a year from a small workplace pension. Spends £760 a year on electricity and £320 on petrol and diesel, the average for households in the lowest tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(1).source,
  },
  {
    id: "carer",
    label: "A carer working part time",
    short: "Carer",
    description: "Aged 50, cares 35 hours a week, earns £12,000",
    icon: "handHeart",
    measure: "carers_allowance_earnings_taper",
    // The year it starts on the chip, as the threshold freeze's had: the
    // calculator's years start in 2027-28, and the taper "within 2030-31"
    // (Budget 2026, 6.13)
    tag: "Carer's taper, 2030-31",
    inputs: {
      ...RESET,
      current_age: 50,
      // About 18 hours a week at the National Living Wage from April 2026
      // (£12.71 an hour, GOV.UK): a little above the 16 hours at the
      // National Living Wage that Carer's Allowance's weekly earnings
      // limit is set at (£204 a week in 2026-27, DWP), so about £27 a
      // week above it in 2026-27
      current_salary: 12000,
      has_partner: true,
      partner_age: 52,
      // The UK median salary in April 2026, the form's default (ONS ASHE
      // 2026 provisional, householdDefaults.js): with it the couple is due
      // no Universal Credit
      partner_salary: 34200,
      tenure: "OWNED_WITH_MORTGAGE",
      // A carer for 35 hours a week, Carer's Allowance's minimum (DWP), for
      // someone who gets a qualifying disability benefit
      is_carer: true,
      care_hours_per_week: 35,
      // Its tenth by gross income: the couple's £47,300 a year in 2027-28,
      // £910 a week
      ...spendingInputs(5),
    },
    note: "Aged 50, lives with their partner, aged 52, and owns their home with a mortgage. Cares for their mother, who lives nearby and gets Attendance Allowance, for 35 hours a week, and works about 18 hours a week at the 2026 National Living Wage (£12.71 an hour, GOV.UK): £12,000 a year, about £27 a week more than the £204 a week a carer can earn in 2026-27 and still receive Carer's Allowance (DWP). Their partner earns £34,200, the UK median salary (ONS ASHE 2026, provisional). The couple is due no Universal Credit. Spends £1,060 a year on electricity and £970 on petrol and diesel, the average for households in the fifth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(5).source,
  },
  {
    // Takes the commuter's place (Vahid, 28 October 2026): the savings
    // income tax rise is in the Household calculator only (not in the
    // national results, calculatorOnlyMeasures.js), always included there.
    // A basic-rate taxpayer whose savings interest is well above their
    // £1,000 Personal Savings Allowance, so the 2-point rise reaches £9,000
    // of it: about £180 a year. Salary and interest together stay inside
    // the basic-rate band in every year, and the salary is above the £5,000
    // starting rate for savings band's reach
    id: "saver",
    label: "A saver with interest income",
    short: "Saver",
    description: "£30,000 salary, £10,000 a year of savings interest",
    icon: "piggyBank",
    measure: "savings_income_rates_up",
    tag: "Savings tax",
    inputs: {
      ...RESET,
      current_age: 60,
      current_salary: 30000,
      tenure: "OWNED_OUTRIGHT",
      // About £250,000 in savings at 4%
      savings_interest_per_year: 10000,
      // Its tenth by gross income: £40,000 a year, about £770 a week
      ...spendingInputs(5),
    },
    note: "Aged 60, earns £30,000 and owns their home outright. Has about £250,000 in savings, which pay £10,000 a year of interest at 4%. Spends £1,060 a year on electricity and £970 on petrol and diesel, the average for households in the fifth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(5).source,
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
    description: "£50,000 salary, rent from a flat, savings interest",
    icon: "briefcase",
    // The property rate (the savings rate is not in the release): its
    // colour on the card and its own part. The savings interest stays an
    // input: it is part of the household
    measure: "property_income_rates_up",
    measures: ["property_income_rates_up"],
    tag: "Property tax",
    inputs: {
      ...RESET,
      current_age: 55,
      current_salary: 50000,
      tenure: "OWNED_OUTRIGHT",
      property_income_per_year: 9000,
      // No dividends: the Budget raises the savings and property income
      // rates, not the dividend rates (Budget 2026, 6.246 and 6.247)
      savings_interest_per_year: 2000,
      ...spendingInputs(8),
    },
    note: "Aged 55, earns £50,000 and owns their home outright. Lets a flat for £9,000 a year after costs, and gets £2,000 of savings interest. Spends £1,120 a year on electricity and £1,350 on petrol and diesel, the average for households in the eighth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(8).source,
  },
  {
    id: "landlord-45k",
    label: "A middle earner who lets a flat",
    short: "Small landlord",
    description: "£45,000 salary, £6,000 from a flat, £2,000 interest",
    icon: "key",
    // The property rate, as the landlord's (the savings rate is not in the
    // release); the savings interest stays an input
    measure: "property_income_rates_up",
    measures: ["property_income_rates_up"],
    tag: "Property tax",
    inputs: {
      ...RESET,
      // The household in PolicyEngine's post on the savings and property
      // income rates (app-v2 #1460, at f581840f) whose property income
      // takes its savings interest into the higher-rate band; aged 35 as
      // there (age changes none of these taxes). The post's £150 more
      // income tax a year was both rates together; the property rate alone
      // is £120 a year here
      current_age: 35,
      current_salary: 45000,
      tenure: "OWNED_WITH_MORTGAGE",
      // Rent after allowable expenses, with no finance costs (the form has
      // no question for a landlord's mortgage interest)
      property_income_per_year: 6000,
      savings_interest_per_year: 2000,
      // Its tenth by gross income: £54,080 a year in 2027-28, £1,040 a week
      ...spendingInputs(6),
    },
    note: "Aged 35, earns £45,000 and owns their home with a mortgage. Lets a flat, with no mortgage on it, for £6,000 a year after costs, and gets £2,000 of savings interest. Spends £1,020 a year on electricity and £1,080 on petrol and diesel, the average for households in the sixth tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: decileSpending(6).source,
  },
  {
    // Added for the £2 bus fare cap (#321, Vahid, 29 October 2026): a
    // renter in England outside London, where the form asks bus fares, who
    // has no car and takes the bus to work. The credit is a share of the
    // fares paid in the cap's years (2026-27 and 2027-28); nothing after
    id: "bus-commuter",
    label: "A bus commuter in the North West",
    short: "Bus commuter",
    description: "Aged 28, earns £22,000, £700 a year on bus fares",
    icon: "bus",
    measure: "bus_fare_cap_2027",
    tag: "Bus fare cap",
    inputs: {
      ...RESET,
      current_age: 28,
      current_salary: 22000,
      tenure: "RENT_PRIVATELY",
      // Fixed: the North West's average private rent (ONS, September 2026)
      monthly_rent: 975,
      // Electricity: the average for its tenth by gross income (£423 a
      // week of earnings, ONS Family Spending FYE 2025, Table A6)
      ...spendingInputs(2),
      // No car
      petrol_spending_per_year: 0,
      diesel_spending_per_year: 0,
      // About 230 single journeys a year at £3 (DfT)
      bus_fare_spending_per_year: 700,
    },
    note: "Aged 28, earns £22,000 and rents privately at £975 a month in the North West. Has no car and takes the bus to work: spends £700 a year on bus fares, about 230 single journeys at £3. Claims the Universal Credit they are due. Spends £890 a year on electricity, the average for households in the second tenth by gross income (ONS Family Spending, FYE 2025).",
    spendingSource: own("Bus fares: its own; no car. Electricity", 2),
  },
];
