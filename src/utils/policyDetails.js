/**
 * Card details for the Policies view, by measure id: text the publication
 * does not carry yet (#185 on #104). The catalogue (measureCatalogue.jsx)
 * still decides which measures exist, their names, order and colours; an
 * entry here only adds a card's summary, timing and caveat when the
 * catalogue publishes that id with the description the entry was written
 * for (`writtenFor`, below), and is ignored otherwise. A measure without
 * an entry, or changed since (on Budget day, say: its parameters and so its
 * description), shows its published description and no timeline: an
 * entry's figures and dates are never shown for a measure they may no
 * longer describe.
 *
 * Fields:
 * - summary: one plain line on what changes;
 * - starts: when it takes effect;
 * - affects: who it reaches, in a few words, for the card's "At a glance";
 * - type: tax, duty, benefit or the like;
 * - inForce: the months it is in force, as "YYYY-MM" (`to` is the last
 *   month; a lasting measure has none), for the card's timeline;
 * - ends: when a temporary measure ends, in words (only with `to`);
 * - duration: a temporary measure's length in words, where a count of
 *   months would mislead (a one-off winter payment);
 * - steps / stepsLabel: dated stages within a measure, drawn as diamonds,
 *   with one short label for them all;
 * - howCalculated: how the model applies it, in a sentence (first under
 *   "About this result › How it's calculated");
 * - details: how it is modelled, and the main assumption or caveat
 *   (collapsed by default, under "About this result");
 * - caveats: further caveats, in sentences, where the details state none;
 * - source: a public page on the policy, where one exists;
 * - writtenFor: the measure's description in reforms.py, which the
 *   publication carries verbatim, when the entry was written. After
 *   changing a measure in reforms.py, check its entry still holds, then copy
 *   the new description here (or delete the entry).
 * - sentence: the measure as the subject of a sentence, a verb phrase
 *   ("unfreezing the student loan threshold"), for the charts' headlines;
 * - shortName: a short name for the measure keys' chips, the household
 *   waterfall and other tight labels (the full published name stays in
 *   their tooltips and accessible names).
 * Revenue figures stay in the charts and are not repeated here.
 *
 * TRIAL ONLY (review-edits-on-104): this belongs in the published manifest
 * (reforms.py) so the page keeps no measure list of its own.
 */
export const POLICY_DETAILS = [
  {
    id: "fuel_duty_rise_deferral",
    shortName: "Fuel duty deferral",
    sentence: "deferring the fuel duty rises",
    name: "Fuel duty rises deferred",
    description: "Defer the January and March 2027 fuel duty rises",
    writtenFor: "Candidate measure. Fuel duty stays at 52.95p a litre through winter 2026-27, with no April 2027 RPI rise; the 5p is restored in 2027-28 (3p on 1 September, 2p on 1 December 2027), and RPI uprating resumes in April 2028 from 57.95p, so that rise is never made up. Rates are day-weighted to fiscal years. Includes the VAT on the lower pump price.",
    summary:
      "Keeps fuel duty at 52.95p a litre until September 2027, then restores the 5p in two steps by December 2027.",
    starts: "January 2027",
    affects: "Households buying petrol or diesel",
    type: "Fuel duty",
    inForce: { from: "2027-01" },
    steps: [
      { month: "2027-09", label: "3p of the 5p restored" },
      { month: "2027-12", label: "the other 2p restored" },
    ],
    stepsLabel: "5p restored",
    howCalculated:
      "Applies the duty rate in force on each day to households' petrol and diesel spending, day-weighted to fiscal years.",
    details:
      "Assumes 3p back on 1 September and 2p on 1 December 2027, then RPI from April 2028 on 57.95p. The April 2027 RPI rise is skipped and never made up, so duty stays about 2p a litre below current law and the policy costs revenue in every later year. Includes the VAT on the lower pump price; fuel spending is held fixed. Fuel bought for vans, lorries and business use of cars is not modelled, so the revenue figure covers households' own purchases only.",
    source: {
      label: "HMRC fuel duty rates 2026 to 2027",
      href: "https://www.gov.uk/government/publications/amended-fuel-duty-rates-for-2026-to-2027/amended-fuel-duty-rates-2026-to-2027",
    },
  },
  {
    id: "state_pension_income_tax_protection",
    shortName: "State Pension protection",
    sentence: "keeping income tax off the State Pension",
    name: "State Pension income tax protection",
    description:
      "No income tax for pensioners whose only income is the State Pension",
    writtenFor: "Candidate measure. From 6 April 2027, people over State Pension age whose only income is the State Pension (savings interest aside) get an income tax allowance equal to the full new State Pension (rounded up to the pound: £13,037 in 2027-28), rising with it. Someone whose only income is the full new State Pension pays no income tax; £1 of other income takes the allowance away.",
    summary:
      "People whose only income is the full new State Pension pay no income tax.",
    starts: "April 2027",
    affects: "People over State Pension age",
    type: "Income tax",
    inForce: { from: "2027-04" },
    howCalculated:
      "Gives people over State Pension age whose only income is the State Pension, savings interest aside, an income tax allowance equal to the full new State Pension (£13,037 in 2027-28, rising with it).",
    details:
      "Any other income, such as a private pension, takes the allowance away. Based on reporting on 26 October 2026; the mechanism is an assumption made before the Budget.",
    source: {
      label: "The new State Pension: what you'll get",
      href: "https://www.gov.uk/new-state-pension/what-youll-get",
    },
  },
  {
    id: "warm_home_discount_top_up",
    shortName: "Warm Home Discount top-up",
    sentence: "topping up the Warm Home Discount",
    name: "Warm Home Discount top-up",
    description:
      "Raise the Warm Home Discount from £150 to £250 for one winter",
    writtenFor: "Candidate measure. The Warm Home Discount rises from £150 to £250 for winter 2026-27 only: £100 more to each household in Great Britain receiving Universal Credit, Pension Credit, Housing Benefit or income-related ESA. Receipt follows DESNZ's rates: 85% of Pension Credit households and 70% of other eligible households. Eligibility follows England and Wales's 2026-27 core group, so households in Scotland are approximate.",
    summary:
      "Raises the Warm Home Discount from £150 to £250 for winter 2026-27.",
    starts: "Winter 2026-27",
    affects: "Households on means-tested benefits",
    type: "Benefit",
    inForce: { from: "2026-10", to: "2027-03" },
    ends: "After one winter",
    duration: "One winter",
    howCalculated:
      "Adds £100 to the Warm Home Discount for each household that receives it in winter 2026-27.",
    details:
      "Paid to households in Great Britain on Universal Credit, Pension Credit, Housing Benefit or income-related ESA, the 2026-27 core group in England and Wales. Receipt follows DESNZ's rates: 85% of Pension Credit households and 70% of other eligible households receive it. Scotland's scheme has its own core group, so eligibility there is approximate.",
    source: {
      label: "Warm Home Discount",
      href: "https://www.gov.uk/the-warm-home-discount-scheme",
    },
  },
  {
    id: "domestic_electricity_zero_vat",
    shortName: "Zero VAT on electricity",
    sentence: "taking VAT off household electricity",
    name: "Zero VAT on domestic electricity",
    description: "Zero-rate VAT on domestic electricity to March 2028",
    writtenFor: "Candidate measure. VAT on domestic electricity is 0% instead of 5% from 1 October 2026 to 31 March 2028: the zero rate to March 2027, not in the model's baseline, scored with a candidate one-year extension. Applied to electricity spending only, in Great Britain (Northern Ireland keeps the 5%). 2026-27 carries the October to March share of a year's electricity use (about 57%), not a share of its days.",
    summary:
      "Charges no VAT on household electricity bills in Great Britain, instead of 5%, from October 2026 to March 2028.",
    starts: "October 2026",
    affects: "Households in Great Britain",
    type: "VAT",
    inForce: { from: "2026-10", to: "2028-03" },
    ends: "March 2028",
    howCalculated:
      "Applies 0% VAT instead of 5% to each household's electricity spending in the survey.",
    details:
      "The zero rate to March 2027 is already planned but not in the model's baseline; the year to March 2028 is modelled as an extension. Applied to electricity spending only, in Great Britain: Northern Ireland's households keep the 5%. 2026-27 carries the October to March share of a year's electricity use (about 57%), not a share of its days.",
    source: {
      label: "Temporary zero rate of VAT for domestic electricity",
      href: "https://www.gov.uk/government/publications/temporary-zero-rate-of-vat-for-domestic-electricity-in-great-britain/temporary-zero-rate-of-vat-in-great-britain-for-domestic-electricity",
    },
  },
  {
    id: "employer_ni_relief_under_25s",
    shortName: "Employer National Insurance relief, under-25s",
    sentence: "extending employers' National Insurance relief to under-25s",
    name: "Employer NI relief for under-25s",
    description: "No employer National Insurance for employees under 25",
    writtenFor: "Candidate measure. From 6 April 2027 employers pay no secondary Class 1 National Insurance on earnings up to the upper earnings limit (£50,270) for employees under 25, extending the under-21 relief to ages 21 to 24. Wages are held fixed, so it changes revenue, not household incomes. The data identify no apprentices, so the cost includes 21 to 24-year-old apprentices, whose employers already pay none in law.",
    summary:
      "Employers pay no National Insurance on earnings up to £50,270 for employees under 25.",
    starts: "April 2027",
    type: "National Insurance",
    inForce: { from: "2027-04" },
    details:
      "Extends the existing under-21 relief to ages 21 to 24, up to the upper earnings limit. Wages are held fixed, so the policy changes revenue but not household incomes, and shows no change in the household charts.",
  },
  {
    id: "threshold_freeze_2031_32",
    shortName: "Threshold freeze",
    sentence: "freezing the income tax thresholds for 2031-32",
    name: "Threshold freeze to 2031-32",
    description: "Keep income tax thresholds frozen in 2031-32",
    writtenFor: "Candidate measure. The income tax personal allowance stays at £12,570 and the basic rate band at £37,700 (a higher rate threshold of £50,270) for one more year, 2031-32, instead of rising with inflation to £12,830 and £38,500. From 2031-32 policyengine-uk sets the National Insurance primary threshold and upper earnings limit at the personal allowance and higher rate threshold, so they stay at £12,570 and £50,270 too; the employer secondary threshold is not held.",
    summary:
      "Keeps the income tax personal allowance and basic rate band frozen for one more year, to 2031-32.",
    starts: "April 2031",
    affects: "Income taxpayers, and workers paying National Insurance",
    type: "Income tax",
    inForce: { from: "2031-04" },
    howCalculated:
      "Holds the personal allowance at £12,570 and the basic rate band at £37,700 in 2031-32, instead of £12,830 and £38,500.",
    details:
      "The National Insurance primary threshold and upper earnings limit, which the model ties to the personal allowance and higher rate threshold from 2031-32, stay frozen too; the employer threshold is not held.",
    caveats: [
      "The extra year of the freeze is an assumption made before the Budget. Incomes are held fixed, with no behavioural response.",
    ],
    source: {
      label: "Finance Act 2026, section 10 (thresholds frozen to 2030-31)",
      href: "https://www.legislation.gov.uk/ukpga/2026/11/section/10",
    },
  },
  {
    id: "badr_lifetime_limit_cut",
    shortName: "Business sale relief limit halved",
    sentence: "halving the business sale relief limit",
    name: "Business Asset Disposal Relief restricted",
    description: "Halve the Business Asset Disposal Relief lifetime limit",
    writtenFor: "Candidate measure. From 6 April 2027 the lifetime limit on gains qualifying for Business Asset Disposal Relief falls from £1 million to £500,000; the relief rate stays at 18%. Gains above the limit pay the main capital gains tax rates. The model applies the limit to each year's gains. Capital gains are imputed and calibrated to 2024-25, when disposals were unusually high ahead of the April 2025 rise in the relief's rate, so the relief's base, and the revenue from restricting it, are likely 1.5 to 1.7 times too high.",
    summary:
      "Halves the lifetime limit on gains taxed at the 18% Business Asset Disposal Relief rate, from £1 million to £500,000.",
    starts: "April 2027",
    type: "Capital gains tax",
    inForce: { from: "2027-04" },
    details:
      "The £500,000 limit is an assumption made before the Budget. The model applies the limit to each year's gains, as if none had been used before. The figure is the extra tax on each year's disposals, most of which is paid in the January after the tax year ends.",
    source: {
      label: "Business Asset Disposal Relief",
      href: "https://www.gov.uk/business-asset-disposal-relief",
    },
  },
  {
    id: "road_fuel_vat_cut",
    shortName: "Road fuel VAT cut",
    sentence: "cutting VAT on road fuel",
    name: "VAT cut on road fuel",
    description: "Cut VAT on petrol and diesel to 15% for six months",
    writtenFor: "Candidate measure. VAT on petrol and diesel falls from 20% to 15% from 1 December 2026 to 31 May 2027, fully passed through to pump prices; spending on fuel is held fixed. Day-weighted to fiscal years.",
    summary:
      "Cuts VAT on petrol and diesel from 20% to 15% from December 2026 to May 2027.",
    starts: "December 2026",
    affects: "Households buying petrol or diesel",
    type: "VAT",
    inForce: { from: "2026-12", to: "2027-05" },
    ends: "May 2027",
    howCalculated:
      "Applies 15% VAT instead of 20% to households' petrol and diesel spending, day-weighted to fiscal years.",
    details:
      "Assumes the cut is passed through in full to pump prices and fuel spending is unchanged. The rate and dates are assumptions made before the Budget.",
    source: {
      label: "VAT rates on different goods and services",
      href: "https://www.gov.uk/guidance/rates-of-vat-on-different-goods-and-services",
    },
  },
  {
    id: "plan_2_threshold_unfreeze",
    shortName: "Student loan threshold unfrozen",
    sentence: "unfreezing the student loan threshold",
    name: "Plan 2 student loan threshold unfrozen",
    description: "Uprate the Plan 2 repayment threshold with RPI again",
    writtenFor: "Candidate measure. The Plan 2 student loan repayment threshold rises with RPI from April 2027 (to £30,267 in 2027-28), reversing the freeze at £29,385 to April 2030. Repayments are modelled, replacing those reported in the survey, and the revenue figure is the change in modelled repayments.",
    summary:
      "Raises the Plan 2 student loan repayment threshold with RPI from April 2027, instead of freezing it at £29,385.",
    starts: "April 2027",
    affects: "Graduates repaying Plan 2 student loans",
    type: "Student loans",
    inForce: { from: "2027-04" },
    howCalculated:
      "Models each graduate's Plan 2 repayments from their income and the RPI-uprated threshold, replacing the repayments reported in the survey.",
    details:
      "The revenue figure is the change in graduates' cash repayments each year, not the effect on public sector borrowing, which treats changes to loan terms differently.",
    source: {
      label: "Repaying your student loan",
      href: "https://www.gov.uk/repaying-your-student-loan/what-you-pay",
    },
  },
];

const DETAILS_BY_ID = Object.fromEntries(
  POLICY_DETAILS.map(({ id, name: _name, description: _description, writtenFor, ...fields }) => [id, { writtenFor, fields }]),
);

/**
 * The card details for a catalogue measure, or null: none unless the
 * publication describes it exactly as when its entry was written.
 */
export function policyDetailsFor(measure) {
  const entry = measure ? DETAILS_BY_ID[measure.id] : undefined;
  return entry && entry.writtenFor === measure.description ? entry.fields : null;
}

/**
 * A catalogue measure's summary, for its info tip: its entry's summary while
 * the publication describes it exactly as when the entry was written; else
 * the whole first sentence of the published description, without its
 * "Candidate measure." label, never cut short. Null only when the
 * publication carries no description.
 */
export function measureSummary(measure) {
  const summary = policyDetailsFor(measure)?.summary;
  if (summary) return summary;
  const text = String(measure?.description ?? "")
    .replace(/^\s*Candidate measure\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
}

/** A catalogue measure with its card details, where there are any. */
export function withPolicyDetails(measure) {
  return measure ? { ...(policyDetailsFor(measure) ?? {}), ...measure } : measure;
}

/**
 * A catalogue measure's short name: its entry's, while the publication
 * describes it exactly as when the entry was written; else its published
 * name.
 */
export function shortNameOf(measure) {
  return policyDetailsFor(measure)?.shortName ?? measure?.label ?? measure?.name ?? measure?.id;
}
