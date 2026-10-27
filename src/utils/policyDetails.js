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
 * - type: tax, duty, benefit or the like;
 * - inForce: the months it is in force, as "YYYY-MM" (`to` is the last
 *   month; a lasting measure has none), for the card's timeline;
 * - ends: when a temporary measure ends, in words (only with `to`);
 * - duration: a temporary measure's length in words, where a count of
 *   months would mislead (a one-off winter payment);
 * - steps / stepsLabel: dated stages within a measure, drawn as diamonds,
 *   with one short label for them all;
 * - details: the main assumption or caveat (collapsed by default);
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
    shortName: "Fuel duty frozen",
    sentence: "freezing fuel duty to 2028",
    name: "Fuel duty rises deferred",
    description: "Cancel the January 2027 fuel duty rise and freeze to March 2028",
    writtenFor: "Candidate measure. Fuel duty stays at 52.95p a litre through 2027-28 (to 31 March 2028): the rise due on 1 January 2027 does not happen, so the 5p cut continues, and there is no March 2027 step and no April 2027 RPI rise. RPI uprating resumes in April 2028 from 52.95p, so the 5p and that year's RPI are never made up. Rates are day-weighted to fiscal years. Includes the VAT on the lower pump price.",
    summary:
      "Keeps fuel duty at 52.95p a litre to March 2028, so the 5p cut is never reversed.",
    starts: "January 2027",
    type: "Fuel duty",
    inForce: { from: "2027-01" },
    details:
      "Assumes no rise on 1 January 2027 and none in March or April 2027, then RPI uprating from April 2028 on 52.95p. Duty stays the 5p and a year's RPI below current law, so the policy costs revenue in every later year. Includes the VAT on the lower pump price; fuel spending is held fixed. Fuel bought for vans, lorries and business use of cars is not modelled, so the revenue figure covers households' own purchases only.",
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
      "No income tax for pensioners whose total income is at most the full new State Pension",
    writtenFor: "Candidate measure. From 6 April 2027, people over State Pension age whose total income (the State Pension, with any increments or additional State Pension, plus all other income, savings interest included) is at or below the full new State Pension (rounded up to the pound: £13,037 in 2027-28, rising with it) get an income tax allowance of that amount, so pay no income tax. Above it there is no allowance: £1 of income over the threshold takes the whole allowance away.",
    summary:
      "People over State Pension age whose total income is no more than the full new State Pension pay no income tax.",
    starts: "April 2027",
    type: "Income tax",
    inForce: { from: "2027-04" },
    details:
      "Modelled as an allowance equal to the full new State Pension (£13,037 in 2027-28, rising with it) for people over State Pension age whose total income, the State Pension and any other income, savings interest included, is at or below it. £1 of income above it takes the whole allowance away, so a larger State Pension (with increments or additional State Pension) alone can rule someone out. Based on reporting on 26 and 27 October 2026; the mechanism is an assumption made before the Budget.",
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
    shortName: "Zero VAT on electricity",
    sentence: "taking VAT off household electricity",
    name: "Zero VAT on domestic electricity",
    description: "Zero-rate VAT on domestic electricity to March 2028",
    writtenFor: "Candidate measure. VAT on domestic electricity is 0% instead of 5% from 1 October 2026 to 31 March 2028: the zero rate to March 2027, not in the model's baseline, scored with a candidate one-year extension. Applied to electricity spending only, in Great Britain (Northern Ireland keeps the 5%). 2026-27 carries the October to March share of a year's electricity use (about 57%), not a share of its days.",
    summary:
      "Charges no VAT on household electricity bills in Great Britain, instead of 5%, from October 2026 to March 2028.",
    starts: "October 2026",
    type: "VAT",
    inForce: { from: "2026-10", to: "2028-03" },
    ends: "March 2028",
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
    type: "Income tax",
    inForce: { from: "2031-04" },
    details:
      "The National Insurance primary threshold and upper earnings limit, which the model ties to the personal allowance and higher rate threshold from 2031-32, stay frozen too; the employer threshold is not held.",
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
    type: "VAT",
    inForce: { from: "2026-12", to: "2027-05" },
    ends: "May 2027",
    details:
      "Assumes the cut is passed through in full to pump prices and fuel spending is unchanged. The rate and dates are assumptions made before the Budget.",
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
    type: "Student loans",
    inForce: { from: "2027-04" },
    details:
      "The threshold rises to £30,267 in 2027-28. Repayments are modelled, replacing those reported in the survey. The revenue figure is the change in graduates' cash repayments each year, not the effect on public sector borrowing, which treats changes to loan terms differently.",
    source: {
      label: "Repaying your student loan",
      href: "https://www.gov.uk/repaying-your-student-loan/what-you-pay",
    },
  },
  {
    id: "carers_allowance_earnings_taper",
    shortName: "Carer's Allowance taper",
    sentence: "tapering Carer's Allowance above the earnings limit",
    name: "Carer's Allowance earnings taper",
    description: "Withdraw Carer's Allowance £1 for £1 above the earnings limit",
    writtenFor: "Candidate measure. From 2030-31 Carer's Allowance no longer stops when weekly net earnings pass the £204 earnings limit: it is reduced by £1 for each £1 of weekly earnings above the limit, to nothing once earnings exceed the limit by the full weekly rate. Carers at or below the limit are unchanged. Scotland's Carer Support Payment is unchanged. Claims by carers the limit kept out follow the data's take-up draw (60%). For a carer on Universal Credit the model counts the extra allowance in full as unearned income but deducts none of the PAYE on it from earnings, as DWP would, so such a carer can lose overall.",
    summary:
      "Replaces the Carer's Allowance cliff edge at the £204 weekly earnings limit with a taper of £1 for each £1 earned above it, from 2030-31.",
    starts: "April 2030",
    type: "Benefit",
    inForce: { from: "2030-04" },
    details:
      "The start year, the limit (frozen at £204) and the £1-for-£1 rate are assumptions from reports of the announcement before the Budget. Scotland's Carer Support Payment is unchanged. Universal Credit counts Carer's Allowance in full as unearned income, and the allowance is taxable, so a carer on Universal Credit gains nothing and can lose the income tax on it. Carers the limit kept out claim at the data's 60% take-up.",
    source: {
      label: "Carer's Allowance",
      href: "https://www.gov.uk/carers-allowance",
    },
  },
  {
    id: "lha_unfreeze_2027",
    shortName: "LHA unfrozen",
    sentence: "unfreezing Local Housing Allowance",
    name: "Local Housing Allowance unfrozen",
    description: "Re-set Local Housing Allowance rates to local rents from April 2027",
    writtenFor: "Candidate measure. From April 2027 Local Housing Allowance rates are no longer frozen at their April 2024 level: each April they are re-set to the 30th percentile of local rents, as policyengine-uk determines them from its projected rents, with the national maximum and the March 2020 minimum. It raises Universal Credit's housing element and Housing Benefit for private renters whose rent is above the frozen rate. Northern Ireland's rates, which follow Great Britain's, are unfrozen too.",
    summary:
      "Re-sets Local Housing Allowance rates to the 30th percentile of local rents each April from 2027, ending the freeze at April 2024 levels.",
    starts: "April 2027",
    type: "Benefit",
    inForce: { from: "2027-04" },
    details:
      "Rents are policyengine-uk's own projection of each area's rents, so the size of the re-set is modelled, not published. Only private renters claiming Universal Credit or Housing Benefit with rent above the frozen rate gain. The benefit cap still applies, so a household at the cap gains less or nothing. Northern Ireland's rates, which follow Great Britain's, are unfrozen too.",
    source: {
      label: "Local Housing Allowance rates (SI 2013/2978, article 4)",
      href: "https://www.legislation.gov.uk/uksi/2013/2978/article/4/made",
    },
  },
  {
    id: "employer_nics_secondary_threshold_raise",
    shortName: "Employer NI threshold",
    sentence: "raising the employer National Insurance threshold",
    name: "Employer NI threshold raised",
    description: "Raise the employer National Insurance threshold back to £9,100",
    writtenFor: "Candidate measure. From 6 April 2027 the threshold above which employers pay Class 1 National Insurance goes back from £5,000 to £9,100 a year (£175 a week), rising with CPI from 2031-32 as current law's does; the 15% rate is unchanged. policyengine-uk holds each employer's total cost of employment fixed, so the saving is passed to employees as higher pay in the same year.",
    summary:
      "Raises the earnings threshold for employer National Insurance from £5,000 back to £9,100 a year from April 2027.",
    starts: "April 2027",
    type: "National Insurance",
    inForce: { from: "2027-04" },
    details:
      "The £9,100 threshold is an assumption made before the Budget. policyengine-uk holds each employer's total cost of employment fixed, so the National Insurance saved is paid to employees as higher wages in the same year, and income tax and employee National Insurance are then due on it.",
    source: {
      label: "National Insurance Contributions (Secondary Class 1 Contributions) Act 2025, section 2",
      href: "https://www.legislation.gov.uk/ukpga/2025/11/section/2",
    },
  },
  {
    id: "unearned_income_rates_up",
    shortName: "Unearned income tax up",
    sentence: "raising tax on dividends, savings and property income",
    name: "Dividend, savings and property income tax up",
    description: "Raise income tax on dividends, savings and property income by 2 points",
    writtenFor: "Candidate measure. From 6 April 2027 the income tax rates on dividends, savings income and property income each rise by 2 percentage points on top of current law, which already includes Budget 2025's rises: dividends to 12.75%, 37.75% and 41.35%, and savings and property income to 24%, 44% and 49% at the basic, higher and additional rates. Incomes are held fixed, with no behavioural response.",
    summary:
      "Raises the income tax rates on dividends, savings income and property income by 2 percentage points from April 2027.",
    starts: "April 2027",
    type: "Income tax",
    inForce: { from: "2027-04" },
    details:
      "The 2-point rise is an assumption made before the Budget, on top of the rises Budget 2025 legislated. Incomes are held fixed: no one is assumed to change how much they take in dividends or how they hold savings or property.",
    source: {
      label: "Dividend tax rates (Finance Act 2022, section 4)",
      href: "https://www.legislation.gov.uk/ukpga/2022/3/section/4/enacted",
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
