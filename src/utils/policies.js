/**
 * The candidate Autumn Budget 2026 measures the page shows, one entry per
 * measure in src/uk_budget_data/reforms.py (same id and name). Each is a
 * candidate modelled before the Budget on 28 October 2026, not announced
 * policy; the page says so once, in the banner under the intro.
 *
 * Card fields, for the Policies view:
 * - summary: one plain line on what changes;
 * - starts: when it takes effect;
 * - type: tax, duty, benefit or the like;
 * - details: the main assumption or caveat (collapsed by default);
 * - source: a public page on the policy, where one exists.
 * Revenue figures stay in the charts and are not repeated here.
 */
export const POLICIES = [
  {
    id: "fuel_duty_rise_deferral",
    name: "Fuel duty rises deferred",
    description: "Defer the January and March 2027 fuel duty rises",
    summary:
      "Keeps fuel duty at 52.95p a litre through winter 2026-27, restoring the 5p in two steps in autumn 2027.",
    starts: "January 2027",
    type: "Fuel duty",
    details:
      "Assumes no RPI rise in April 2027, 3p back on 1 September and 2p on 1 December 2027, then RPI from April 2028 on 57.95p. Includes the VAT on the lower pump price; fuel spending is held fixed.",
    source: {
      label: "HMRC fuel duty rates 2026 to 2027",
      href: "https://www.gov.uk/government/publications/amended-fuel-duty-rates-for-2026-to-2027/amended-fuel-duty-rates-2026-to-2027",
    },
  },
  {
    id: "state_pension_income_tax_protection",
    name: "State Pension income tax protection",
    description:
      "No income tax for pensioners whose only income is the State Pension",
    summary:
      "People whose only income is the full new State Pension pay no income tax.",
    starts: "April 2027",
    type: "Income tax",
    details:
      "Modelled as an allowance for people over State Pension age equal to the full new State Pension (£13,040 in 2027-28), withdrawn £1 for £1 of other income down to the standard personal allowance. The mechanism is not yet published.",
  },
  {
    id: "warm_home_discount_top_up",
    name: "Warm Home Discount top-up",
    description:
      "Raise the Warm Home Discount from £150 to £250 for one winter",
    summary:
      "Raises the Warm Home Discount from £150 to £250 for winter 2026-27.",
    starts: "Winter 2026-27",
    type: "Benefit",
    details:
      "Paid to households in Great Britain on Universal Credit, Pension Credit, Housing Benefit or income-related ESA, the 2026-27 core group in England and Wales. Receipt follows DESNZ's rates: 85% of Pension Credit households and 70% of other eligible households receive it. Scotland's scheme has its own core group, so eligibility there is approximate.",
    source: {
      label: "Warm Home Discount",
      href: "https://www.gov.uk/the-warm-home-discount-scheme",
    },
  },
  {
    id: "domestic_electricity_zero_vat",
    name: "Zero VAT on domestic electricity",
    description: "Zero-rate VAT on domestic electricity to March 2028",
    summary:
      "Charges no VAT on household electricity bills, instead of 5%, from October 2026 to March 2028.",
    starts: "October 2026",
    type: "VAT",
    details:
      "The zero rate to March 2027 is already planned but not in the model's baseline; the year to March 2028 is the candidate extension. Applied to electricity spending only.",
    source: {
      label: "Temporary zero rate of VAT for domestic electricity",
      href: "https://www.gov.uk/government/publications/temporary-zero-rate-of-vat-for-domestic-electricity-in-great-britain/temporary-zero-rate-of-vat-in-great-britain-for-domestic-electricity",
    },
  },
  {
    id: "employer_ni_relief_under_25s",
    name: "Employer NI relief for under-25s",
    description: "No employer National Insurance for employees under 25",
    summary:
      "Employers pay no National Insurance on earnings up to £50,270 for employees under 25.",
    starts: "April 2027",
    type: "National Insurance",
    details:
      "Extends the existing under-21 relief to ages 21 to 24, up to the upper earnings limit. Wages are held fixed, so the measure changes revenue but not household incomes, and shows no change in the household charts.",
  },
  {
    id: "threshold_freeze_2031_32",
    name: "Threshold freeze to 2031-32",
    description: "Keep income tax thresholds frozen in 2031-32",
    summary:
      "Keeps the income tax personal allowance and basic rate band frozen for one more year, to 2031-32.",
    starts: "April 2031",
    type: "Income tax",
    details:
      "The personal allowance stays at £12,570 and the higher rate threshold at £50,270, instead of rising with inflation to £12,830 and £51,330. The National Insurance primary threshold and upper earnings limit, which the model ties to them from 2031-32, stay at the same levels; the employer threshold is not held.",
  },
  {
    id: "badr_lifetime_limit_cut",
    name: "Business Asset Disposal Relief restricted",
    description: "Halve the Business Asset Disposal Relief lifetime limit",
    summary:
      "Halves the lifetime limit on gains taxed at the 18% Business Asset Disposal Relief rate, from £1 million to £500,000.",
    starts: "April 2027",
    type: "Capital gains tax",
    details:
      "The value is an assumption: reporting says the relief may be restricted, not how. The model applies the limit to each year's gains, as if none had been used before.",
    source: {
      label: "Business Asset Disposal Relief",
      href: "https://www.gov.uk/business-asset-disposal-relief",
    },
  },
  {
    id: "road_fuel_vat_cut",
    name: "VAT cut on road fuel",
    description: "Cut VAT on petrol and diesel to 15% for six months",
    summary:
      "Cuts VAT on petrol and diesel from 20% to 15% from December 2026 to May 2027.",
    starts: "December 2026",
    type: "VAT",
    details:
      "Assumes the cut is passed through in full to pump prices and fuel spending is unchanged. The rate and dates are assumptions; reporting names the option, not its design.",
  },
  {
    id: "plan_2_threshold_unfreeze",
    name: "Plan 2 student loan threshold unfrozen",
    description: "Uprate the Plan 2 repayment threshold with RPI again",
    summary:
      "Raises the Plan 2 student loan repayment threshold with RPI from April 2027, instead of freezing it at £29,385.",
    starts: "April 2027",
    type: "Student loans",
    details:
      "The threshold rises to £30,267 in 2027-28. Repayments are modelled, replacing those reported in the survey.",
    source: {
      label: "Repaying your student loan",
      href: "https://www.gov.uk/repaying-your-student-loan/what-you-pay",
    },
  },
];

/** Each policy's name, by id. */
export const POLICY_NAME_BY_ID = Object.fromEntries(
  POLICIES.map((policy) => [policy.id, policy.name]),
);
