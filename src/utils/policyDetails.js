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
 * - outsidePovertyIncome: true where the model pays the measure through a
 *   variable HBAI's household net income leaves out (policyengine-uk's
 *   hbai_household_net_income), so poverty and inequality cannot move with
 *   it even in the years it is in force;
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
 * - cardOrder: the card's place on the Policies tab (1 up), set so the two
 *   cards in a row are close in height (the charts together, the tiles
 *   together); cards without one follow, by budgetRows;
 * - budgetRows: the measure's rows in the Budget's Table 6.1 (as
 *   data_inputs/treasury/mapping.csv maps them), which link each card to
 *   the Budget's costing;
 * - example: { title, text, items?, source }: a worked example, or the reach the
 *   Budget states, every figure from its source (a cited document or a
 *   verified household calculation), shown under "What changes": one short line, and any further points as
 *   a short list (`items`), never a long paragraph;
 * - changeLabel: { label, unitWords } a shorter name and units for the What
 *   changes block's main row, in place of policy_parameters.json's;
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
    cardOrder: 1,
    shortName: "Fuel duty cut extended",
    sentence: "extending the 5p fuel duty cut to 1 July 2027",
    name: "Fuel duty cut extended",
    description: "Keep the 5p fuel duty cut to July 2027",
    writtenFor: "The 5p cut in fuel duty is kept: the main rate stays at 52.95p a litre to 30 June 2027, so the rise due on 1 January 2027 and the March and April 2027 steps do not happen. From 1 July 2027 it returns to current law's 60.59p a litre, rising with RPI each April. Rates are day-weighted to fiscal years, and the VAT on the lower pump price is included.",
    summary:
      "Keeps fuel duty at 52.95p a litre to July 2027, then returns it to current law's rate.",
    starts: "Jan 2027",
    affects: "Households buying petrol or diesel",
    type: "Fuel duty",
    inForce: { from: "2027-01" },
    howCalculated:
      "Applies each day's duty rate to households' petrol and diesel spending, day-weighted to fiscal years.",
    details:
      "Held at 52.95p a litre to 30 June 2027: none of current law's rises in January, March or April 2027. From 1 July 2027 it is current law's 60.59p, which includes April 2027's RPI rise. RPI rises then resume each April from 2028. After that it costs nothing. The end date is the Budget document's. Includes the VAT on the lower pump price; fuel spending is held fixed. Fuel for vans, lorries and business use of cars is not modelled, so the figure covers households' own fuel. The Treasury's figure also covers business fuel, but counts duty only, without VAT.",
    source: {
      label: "HMRC fuel duty rates 2026 to 2027",
      href: "https://www.gov.uk/government/publications/amended-fuel-duty-rates-for-2026-to-2027/amended-fuel-duty-rates-2026-to-2027",
    },
    changeLabel: { label: "Duty", unitWords: "pence a litre" },
    budgetRows: [3],
  },
  {
    id: "state_pension_income_tax_protection",
    cardOrder: 7,
    shortName: "Pension Tax Allowance",
    sentence: "introducing the Pension Tax Allowance",
    name: "Pension Tax Allowance",
    description:
      "An income tax reduction for pensioners with total income up to the full new State Pension",
    writtenFor: "From 6 April 2027 to 5 April 2030, people over State Pension age whose total income (the State Pension, with any increments or additional State Pension, plus all other income, savings interest included) is at or below the full new State Pension (£13,036.40 in 2027-28) get a Pension Tax Allowance: a non-refundable reduction in their income tax, worth up to £94 in 2027-28. It falls by £1 for every £3 of income above the full new State Pension, so it is gone at about £13,319 in 2027-28. The personal allowance is unchanged.",
    summary:
      "Pensioners on up to the full new State Pension pay less income tax, 2027-28 to 2029-30.",
    starts: "Apr 2027",
    affects: "People over State Pension age",
    type: "Income tax",
    inForce: { from: "2027-04", to: "2030-03" },
    ends: "Apr 2030",
    howCalculated:
      "Cuts eligible people's income tax, never below zero; it tapers by £1 per £3 above the full new State Pension.",
    details:
      "Total income counts the State Pension and all other income, savings interest included. So a larger State Pension, with increments or additional State Pension, reduces the allowance too. The personal allowance is unchanged. People reaching State Pension age after 6 October in a tax year are not included: reach and cost slightly understated. Scottish taxpayers get the same allowance, at the 20% basic rate. Means-tested benefits can take back part of the allowance. Pension Credit, Housing Benefit and Council Tax Reduction count income after tax. A smaller award can end help that comes with it. Universal Credit counts pension income before tax, so changes only where the allowance cuts tax on earnings.",
    source: {
      label: "Pension Tax Allowance explainer",
      href: "https://www.gov.uk/government/publications/pension-tax-allowance-explainer/pension-tax-allowance-explainer",
    },
    changeLabel: { label: "Largest tax cut", unitWords: "£ a year" },
    budgetRows: [52],
    example: {
      title: "Example",
      text: "2027-28: on the full new State Pension (£13,036), no income tax; at £13,186, the allowance is £44.",
      source: { label: "Pension Tax Allowance explainer", href: "https://www.gov.uk/government/publications/pension-tax-allowance-explainer/pension-tax-allowance-explainer" },
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
    cardOrder: 5,
    shortName: "Zero VAT on electricity",
    sentence: "taking VAT off household electricity",
    name: "Zero VAT on domestic electricity",
    description: "Zero-rate VAT on domestic electricity to July 2027",
    writtenFor: "VAT on domestic electricity is 0% instead of 5% from 1 October 2026 to 30 June 2027. It applies in Great Britain from October 2026 and across the UK from April 2027. It covers electricity only, not gas. Each year counts its share of a year's electricity use: about 57% in 2026-27 (October to March) and 22% in 2027-28 (April to June).",
    summary:
      "Charges no VAT on household electricity bills, instead of 5%, from October 2026 to July 2027.",
    starts: "Oct 2026",
    affects: "Households in Great Britain, and expected in Northern Ireland from April 2027",
    type: "VAT",
    inForce: { from: "2026-10", to: "2027-06" },
    ends: "Jul 2027",
    howCalculated:
      "Applies 0% VAT instead of 5% to each household's electricity spending in the survey.",
    details:
      "Shares of a year's electricity use: October to March for 2026-27 (about 57%), April to June for 2027-28 (about 22%). Both from DESNZ Energy Trends.",
    // HMRC's VAT Notice 701/19, which sets out the zero rate's dates and
    // where it applies (#290, Max, 6480086305)
    source: {
      label: "VAT on fuel and power (VAT Notice 701/19)",
      href: "https://www.gov.uk/guidance/vat-on-fuel-and-power-notice-70119",
    },
    budgetRows: [2],
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
    source: {
      label: "Finance Act 2026, section 10 (thresholds frozen to 2030-31)",
      href: "https://www.legislation.gov.uk/ukpga/2026/11/section/10",
    },
    caveats: [
      "The extra year of the freeze is an assumption made before the Budget. Incomes are held fixed, with no behavioural response.",
    ],
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
  {
    id: "carers_allowance_earnings_taper",
    cardOrder: 2,
    shortName: "Carer's Allowance taper",
    sentence: "tapering Carer's Allowance above the earnings limit",
    name: "Carer's Allowance earnings taper",
    description: "Withdraw Carer's Allowance £1 for £1 above the earnings limit",
    writtenFor: "In England and Wales, Carer's Allowance no longer stops when weekly net earnings pass the Weekly Earnings Limit, 16 hours at the National Living Wage (£212 a week at April 2027's £13.21, rounded up to the pound): it is reduced by £1 for each £1 of earnings above the limit, a 100% taper, to nothing once earnings exceed the limit by the full weekly rate. The taper starts within 2030-31, on a date still to come, so the model counts half of that year. Carers at or below the limit, and Scotland's Carer Support Payment, are unchanged. Claims by carers the limit kept out follow the data's take-up draw (60%). For a carer on Universal Credit the model counts the extra allowance in full as unearned income but deducts none of the PAYE on it from earnings, as DWP would, so such a carer can lose overall.",
    summary:
      "Replaces the earnings-limit cliff edge with a £1-for-£1 taper, in England and Wales from 2030-31.",
    starts: "2030-31",
    affects: "Carers in England and Wales earning above the limit",
    type: "Benefit",
    inForce: { from: "2030-04" },
    howCalculated:
      "Applies the taper to carers' weekly net earnings in the survey, with the limit at 16 hours' National Living Wage.",
    details:
      "The taper starts within 2030-31, on a date still to come, so the model counts half that year. Scotland's Carer Support Payment is unchanged. On Universal Credit, a carer gains nothing (it counts the allowance in full) and can lose the tax on it. Carers the limit kept out claim at the data's 60% take-up.",
    source: {
      label: "Carer's Allowance",
      href: "https://www.gov.uk/carers-allowance",
    },
    budgetRows: [7],
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
    affects: "Employers, and their employees through pay",
    type: "National Insurance",
    inForce: { from: "2027-04" },
    howCalculated:
      "Sets the employer threshold at £9,100 a year (£175 a week) from 2027-28, rising with CPI from 2031-32 as current law's does; the 15% rate is unchanged.",
    details:
      "The £9,100 threshold is an assumption made before the Budget. policyengine-uk holds each employer's total cost of employment fixed, so the National Insurance saved is paid to employees as higher wages in the same year, and income tax and employee National Insurance are then due on it.",
    source: {
      label: "National Insurance Contributions (Secondary Class 1 Contributions) Act 2025, section 2",
      href: "https://www.legislation.gov.uk/ukpga/2025/11/section/2",
    },
  },
  {
    id: "property_income_rates_up",
    cardOrder: 6,
    shortName: "Property income tax up",
    sentence: "raising tax on property income",
    name: "Property income tax rates up",
    description: "Raise income tax on property income by 2 points",
    writtenFor: "From 6 April 2027 the income tax rates on property income rise to 24%, 44% and 49% at the basic, higher and additional rates in England, Wales and Northern Ireland: 2 percentage points above current law, which already includes Budget 2025's rises. Finance cost relief for landlords follows the property basic rate, so rises to 24%, Scottish landlords' included. Incomes are held fixed, with no behavioural response.",
    summary:
      "Raises the income tax rates on property income outside Scotland by 2 percentage points from April 2027.",
    starts: "Apr 2027",
    affects: "People with rental income",
    type: "Income tax",
    inForce: { from: "2027-04" },
    howCalculated:
      "Adds 2 points to each property income rate from 2027-28: 24%, 44% and 49% at basic, higher and additional.",
    details:
      "The 2-point rise is on top of the rises Budget 2025 legislated. Scottish taxpayers pay Scottish rates on property income, so their rates don't change. Finance cost relief follows the UK property basic rate, so Scottish landlords' relief also rises to 24%. They pay slightly less tax. Incomes are held fixed: no one changes how they hold property.",
    source: {
      label: "HMRC: changes to tax rates for property, savings and dividend income",
      href: "https://www.gov.uk/government/publications/changes-to-tax-rates-for-property-savings-and-dividend-income",
    },
    budgetRows: [61],
  },
  {
    id: "savings_income_rates_up",
    cardOrder: 8,
    shortName: "Savings income tax up",
    sentence: "raising tax on savings income",
    name: "Savings income tax rates up",
    description: "Raise income tax on savings income by 2 points",
    writtenFor: "From 6 April 2027 the income tax rates on savings income rise to 24%, 44% and 49% at the basic, higher and additional rates across the UK: 2 percentage points above current law, which already includes Budget 2025's rises. Dividend rates are unchanged. Incomes are held fixed, with no behavioural response.",
    summary:
      "Raises the income tax rates on savings income across the UK by 2 percentage points from April 2027.",
    starts: "Apr 2027",
    affects: "People with savings interest",
    type: "Income tax",
    inForce: { from: "2027-04" },
    howCalculated:
      "Adds 2 points to each savings income rate from 2027-28: 24%, 44% and 49%. Dividend rates are unchanged.",
    details:
      "The 2-point rise is on top of the rises Budget 2025 legislated. It applies across the UK: savings income is taxed at UK rates, Scotland included. Incomes are held fixed: no one changes how they hold savings.",
    source: {
      label: "HMRC: changes to tax rates for property, savings and dividend income",
      href: "https://www.gov.uk/government/publications/changes-to-tax-rates-for-property-savings-and-dividend-income",
    },
    budgetRows: [62],
  },
  {
    id: "household_energy_payment_2026",
    cardOrder: 3,
    shortName: "Energy payment",
    sentence: "paying £100 towards energy bills",
    name: "Household Energy Payment",
    description: "Pay £100 to households in council tax bands A to D in England this winter",
    writtenFor: "A one-off £100 payment from January 2027 to each household in England in property valuation bands A to D (the lowest four of England's eight), up to 20 million households, paid into bank accounts and counted as household income in 2026-27. Scotland, Wales and Northern Ireland receive a share of the funding instead, which is not modelled.",
    summary:
      "Pays £100 once, from January 2027, to each household in England in council tax bands A to D.",
    starts: "Jan 2027",
    affects: "Households in England in council tax bands A to D",
    type: "Payment",
    inForce: { from: "2027-01", to: "2027-03" },
    // Paid through ebr_council_tax_rebate (energy_bills_rebate), which
    // policyengine-uk 2.151.0's hbai_household_net_income does not add
    outsidePovertyIncome: true,
    ends: "After one winter",
    duration: "One winter",
    howCalculated:
      "Adds £100 to the income of each household in England whose council tax band is A, B, C or D, in 2026-27.",
    details:
      "The Treasury's cost also covers the devolved governments' Barnett share (about £425 million), which the model leaves out. It also covers £100 million for councils in England for targeted support, also not modelled.",
    source: {
      label: "Budget 2026",
      href: "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html",
    },
    budgetRows: [1],
    example: {
      title: "Who it reaches",
      text: "Up to 20 million households in England (about 80%), including:",
      items: [
        "83% of households spending over a tenth of their income on energy",
        "88% of households in the bottom three income deciles",
      ],
      source: { label: "Budget 2026, paragraphs 3.5 and 3.6", href: "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html" },
    },
  },
  {
    id: "trading_allowance_raise",
    cardOrder: 4,
    shortName: "Trading allowance",
    sentence: "raising the trading allowance",
    name: "Trading allowance raised to £3,000",
    description: "Raise the trading allowance from £1,000 to £3,000",
    writtenFor: "From 6 April 2027 the trading allowance, which relieves trading receipts in place of actual expenses, rises from £1,000 to £3,000, for income tax and Class 4 National Insurance. Without gross receipts in the data, the model relieves a profit up to £3,000 in full and gives no relief above it, so the cost may be overstated for some people and understated for others.",
    summary:
      "Raises the trading allowance, which lets people earn from trading without tax, from £1,000 to £3,000 from April 2027.",
    starts: "Apr 2027",
    affects: "Sole traders with small incomes or expenses under £3,000",
    type: "Income tax",
    inForce: { from: "2027-04" },
    howCalculated:
      "Raises the trading allowance parameter to £3,000 from 2027-28, for income tax and Class 4 National Insurance.",
    details:
      "The Treasury's costing starts in 2028-29, when self-assessment payments fall due; ours starts in 2027-28.",
    source: {
      label: "Budget 2026",
      href: "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html",
    },
    budgetRows: [15],
    example: {
      title: "Example",
      text: "An employee on £30,000 with £3,000 of side income and no expenses pays £400 less income tax in 2027-28.",
      source: { label: "PolicyEngine household calculations, policyengine-uk 2.151.0 (review on PR 290)", href: "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026/pull/290" },
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
