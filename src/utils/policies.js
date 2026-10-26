/**
 * The Autumn Budget 2026 measures the page shows, one entry per measure in
 * src/uk_budget_data/reforms.py (same id and name). Until the Budget on
 * 28 October 2026 they are modelled before announcement: a card's details
 * say which values are assumptions made before the Budget, in wording that
 * stays true after it.
 *
 * Card fields, for the Policies view:
 * - summary: one plain line on what changes;
 * - starts: when it takes effect;
 * - type: tax, duty, benefit or the like;
 * - inForce: the months it is in force, as "YYYY-MM" (`to` is the last
 *   month; a lasting measure has none), for the card's timeline;
 * - ends: when a temporary measure ends, in words (only with `to`);
 * - duration: a temporary measure's length in words, where a count of
 *   months would mislead (a one-off winter payment);
 * - steps / stepsLabel: dated stages within a measure, drawn as diamonds,
 *   with one short label for them all;
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
      "Keeps fuel duty at 52.95p a litre until September 2027, then restores the 5p in two steps by December 2027.",
    starts: "January 2027",
    type: "Fuel duty",
    inForce: { from: "2027-01" },
    steps: [
      { month: "2027-09", label: "3p of the 5p restored" },
      { month: "2027-12", label: "the other 2p restored" },
    ],
    stepsLabel: "5p restored",
    details:
      "Assumes 3p back on 1 September and 2p on 1 December 2027, then RPI from April 2028 on 57.95p. The April 2027 RPI rise is skipped and never made up, so duty stays about 2p a litre below current law and the measure costs revenue in every later year. Includes the VAT on the lower pump price; fuel spending is held fixed.",
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
    inForce: { from: "2027-04" },
    details:
      "Modelled as an allowance for people over State Pension age equal to the full new State Pension (£13,040 in 2027-28), withdrawn £1 for £1 of other income down to the standard personal allowance. The mechanism is an assumption made before the Budget.",
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
    inForce: { from: "2026-10", to: "2027-03" },
    ends: "After one winter",
    duration: "One winter",
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
      "Charges no VAT on household electricity bills in Great Britain, instead of 5%, from October 2026 to March 2028.",
    starts: "October 2026",
    type: "VAT",
    inForce: { from: "2026-10", to: "2028-03" },
    ends: "March 2028",
    details:
      "The zero rate to March 2027 is already planned but not in the model's baseline; the year to March 2028 is modelled as an extension. Applied to electricity spending only, in Great Britain: Northern Ireland's households keep the 5%.",
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
    inForce: { from: "2027-04" },
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
    inForce: { from: "2031-04" },
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
    inForce: { from: "2027-04" },
    details:
      "The £500,000 limit is an assumption made before the Budget. The model applies the limit to each year's gains, as if none had been used before.",
    source: {
      label: "Business Asset Disposal Relief",
      href: "https://www.gov.uk/business-asset-disposal-relief",
    },
  },
  {
    id: "uc_standard_allowance_below_cpi",
    name: "UC standard allowance uprated below CPI",
    description: "Uprate the Universal Credit standard allowance 1% below current law",
    summary: "Sets the Universal Credit standard allowance 1% below current law from April 2027.",
    starts: "April 2027",
    type: "Benefit",
    inForce: { from: "2027-04" },
    details: "DRILL 5 MOCK value: one point below CPI in April 2027, modelled as 1% below current law for all four claimant types.",
  },
  {
    id: "state_pension_income_tax_protection_extended",
    name: "State Pension income tax protection, extended",
    description: "The State Pension allowance, never withdrawn",
    summary: "As the State Pension protection, but the allowance is never withdrawn against other income.",
    starts: "April 2027",
    type: "Income tax",
    inForce: { from: "2027-04" },
    details: "DRILL 5: an alternative to the State Pension income tax protection, left out of the combined run.",
  },
  {
    id: "employer_ni_secondary_threshold_raised",
    name: "Employer NI threshold raised by £1,000",
    description: "Raise the employer NI secondary threshold from £5,000 to £6,000",
    summary: "Raises the threshold above which employers pay National Insurance from £5,000 to £6,000.",
    starts: "April 2027",
    type: "Employer NI",
    inForce: { from: "2027-04" },
    details: "DRILL 5 MOCK value. Costed at fixed pay: no pass-through to wages, so no household effect.",
  },
  {
    id: "cgt_main_rates_up_2pp",
    name: "Capital gains tax main rates up 2 points",
    description: "Raise the main capital gains tax rates from 18% and 24% to 20% and 26%",
    summary: "Raises the main capital gains tax rates by 2 points, to 20% and 26%.",
    starts: "6 April 2027",
    type: "Capital gains tax",
    inForce: { from: "2027-04" },
    details: "DRILL 5 MOCK value. Static: no behavioural response. Gains above the higher rate limit stay at 24% in this run (the additional rate is not changed; see #145).",
  },
  {
    id: "council_tax_surcharge_from_1_5m",
    name: "Council tax surcharge from £1.5m",
    description: "Start the high value council tax surcharge at £1.5m",
    summary: "Starts the high value council tax surcharge at £1.5m (2026 prices), £2,500 a year, from April 2028.",
    starts: "April 2028",
    type: "Council tax",
    inForce: { from: "2028-04" },
    details: "DRILL 5 MOCK value.",
  },
  {
    id: "lha_reset_april_2027",
    name: "Local Housing Allowance reset in April 2027",
    description: "Reset Local Housing Allowance to the 30th percentile of rents",
    summary: "Resets Local Housing Allowance to the 30th percentile of local rents in April 2027, then freezes it.",
    starts: "April 2027",
    type: "Benefit",
    inForce: { from: "2027-04" },
    details: "Great Britain only in this run: Northern Ireland's rates stay frozen (see #145).",
  },
  {
    id: "dividend_rates_up_1pp",
    name: "Dividend tax rates up 1 point",
    description: "Raise each dividend tax rate by 1 point",
    summary: "Raises each dividend tax rate by 1 point from 6 April 2027.",
    starts: "6 April 2027",
    type: "Income tax",
    inForce: { from: "2027-04" },
    details: "DRILL 5 MOCK value. The £10m bracket's rate is not changed in this run (see #145).",
  },
  {
    id: "domestic_gas_zero_vat",
    name: "Zero VAT on domestic gas",
    description: "Remove the 5% VAT on domestic gas for 2027-28",
    summary: "Removes the 5% VAT on domestic gas for 2027-28.",
    starts: "April 2027",
    type: "VAT",
    inForce: { from: "2027-04", to: "2028-03" },
    ends: "March 2028",
    details: "DRILL 5 MOCK value. Great Britain only.",
  },
];

/** Each policy's name, by id. */
export const POLICY_NAME_BY_ID = Object.fromEntries(
  POLICIES.map((policy) => [policy.id, policy.name]),
);
