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
 * - summary: one plain line on what changes, 15 words at most;
 * - points: 2 to 4 short bullets (12 words at most each) under the
 *   summary, each a string or { label, text } with a 1 to 3 word label;
 *   none repeats the summary or At a glance (Starts, Ends, Affects);
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
 * - details: how it is modelled, its assumptions and caveats, as short
 *   bullets (20 words at most each; collapsed by default, under "About
 *   this result"): the method and every limit, so nothing the card needs
 *   for accuracy is lost to its shorter points;
 * - source: a public page on the policy, where one exists;
 * - cardOrder: the card's place on the Policies tab (1 up), set so the two
 *   cards in a row are close in height (the charts together, the tiles
 *   together); cards without one follow, by budgetRows;
 * - budgetRows: the measure's rows in the Budget's Table 6.1 (as
 *   data_inputs/treasury/mapping.csv maps them), which link each card to
 *   the Budget's costing;
 * - example: { title, text, items?, source? }: a worked example, or the reach the
 *   Budget states, every figure from its source (a cited document or a
 *   verified household calculation), shown under "What changes": one short line, and any further points as
 *   a short list (`items`), never a long paragraph;
 * - changeLabel: { label, unitWords } a shorter name and units for the What
 *   changes block's main row, in place of policy_parameters.json's;
 * - visual: { kind, place, ... } the card's visual (components/policies/
 *   PolicyVisual.jsx): `place` "change" draws it in What changes, in place
 *   of the plot and note (`replacesExample` folds the example into it),
 *   "example" in place of the example's words. Its other fields are the
 *   entry's own figures (writtenFor, example), checked against them by
 *   policyVisuals.test.js; the rest come from policy_parameters.json.
 * - writtenFor: the measure's description in reforms.py, which the
 *   publication carries verbatim, when the entry was written. After
 *   changing a measure in reforms.py, check its entry still holds, then copy
 *   the new description here (or delete the entry).
 * - sentence: the measure as the subject of a sentence, a verb phrase
 *   ("unfreezing the student loan threshold"), for the charts' headlines;
 * - noun: the measure as a noun after "the" in a sentence or label ("when
 *   the fuel duty cut has ended", "No fuel duty cut"), where the short name
 *   does not read as one ("Fuel duty cut extended"); nounOf falls back to
 *   the short name, its first letter lowered unless it is a proper name.
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
    noun: "fuel duty change",
    sentence: "changing the fuel duty schedule",
    name: "Fuel duty cut extended",
    description: "Extend the 52.95p fuel duty rate through June 2027",
    writtenFor: "The 5p cut in fuel duty continues to 30 June 2027. The main rate rises to 60.59p a litre on 1 July 2027 and follows the native RPI schedule after that. Compared with the actual pre-Budget schedule, including the January and March 2027 steps; the model applies its own fuel and VAT treatment.",
    summary: "Extends the 52.95p fuel duty rate through June 2027.",
    points: [
      {"label": "Comparison", "text": "Pre-Budget duty schedule, including January and March 2027 increases."},
      {"label": "Later rates", "text": "The July 2027 rate differs from the pre-Budget schedule."},
    ],
    details: [
      "The main pre-Budget rate reaches 60.03p a litre in April 2027.",
      "The government sets 60.59p from July 2027; the rates continue to differ after the temporary cut ends.",
      "We apply the model’s dated fuel duty rates and fiscal-year weighting.",
      "We include household fuel duty and the resulting VAT change.",
      "We hold household fuel spending fixed.",
      "The data lack LPG and natural gas road-fuel quantities, so we cannot publish a complete national estimate.",
      "We leave out fuel for vans, lorries and business use of cars.",
      "The official costing also covers business fuel and excludes VAT.",
    ],
    starts: "Jan 2027",
    affects: "Households buying petrol or diesel",
    type: "Fuel duty",
    inForce: {"from": "2027-01"},
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
    noun: "Pension Tax Allowance",
    sentence: "introducing the Pension Tax Allowance",
    name: "Pension Tax Allowance",
    description:
      "An income tax reduction for pensioners with total income up to the full new State Pension",
    writtenFor: "From 6 April 2027 to 5 April 2030, people over State Pension age whose total income (the State Pension, with any increments or additional State Pension, plus all other income, savings interest included) is at or below the full new State Pension (£13,036.40 in 2027-28) get a Pension Tax Allowance: a non-refundable reduction in their income tax, worth up to £94 in 2027-28. It falls by £1 for every £3 of income above the full new State Pension, so it is gone at about £13,319 in 2027-28. The personal allowance is unchanged.",
    summary: "Cuts income tax for pensioners with income up to the full new State Pension.",
    points: [
      { label: "What counts", text: "The State Pension and all other income, including savings interest." },
      { label: "Unchanged", text: "The personal allowance." },
      { label: "Benefits", text: "Means-tested benefits can take back part of the allowance." },
    ],
    details: [
      "Cuts eligible people's income tax, never below zero; it tapers by £1 per £3 above the full new State Pension.",
      "A larger State Pension, with increments or additional State Pension, reduces the allowance too.",
      "We include people who reach State Pension age within the tax year.",
      "Scottish taxpayers get the same allowance, at the 20% basic rate.",
      "Pension Credit, Housing Benefit and Council Tax Reduction count income after tax.",
      "A smaller award can end help that comes with it.",
      "Universal Credit counts pension income before tax, so changes only where the allowance cuts tax on earnings.",
    ],
    starts: "Apr 2027",
    affects: "People at or reaching State Pension age",
    type: "Income tax",
    inForce: { from: "2027-04", to: "2030-03" },
    ends: "Apr 2030",
    source: {
      label: "Pension Tax Allowance explainer",
      href: "https://www.gov.uk/government/publications/pension-tax-allowance-explainer/pension-tax-allowance-explainer",
    },
    changeLabel: { label: "Largest tax cut", unitWords: "£ a year" },
    budgetRows: [52],
    // The allowance against income in 2027-28, from writtenFor (the full
    // new State Pension, £1 per £3, gone at about £13,319) and the example
    visual: {
      kind: "pension-tax-allowance",
      place: "change",
      replacesExample: true,
      year: "2027-28",
      fullPension: 13036.4,
      goneAt: 13319,
      taper: 3,
      examples: [
        { income: 13036.4, allowance: 94, label: "Full new State Pension: no income tax" },
        { income: 13186, allowance: 44 },
      ],
    },
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
    summary: "Raises the Warm Home Discount from £150 to £250.",
    points: [
      { label: "Benefits", text: "Universal Credit, Pension Credit, Housing Benefit or income-related ESA." },
      { label: "Where", text: "Applies in Great Britain only." },
      { label: "Receipt", text: "85% of Pension Credit households, 70% of others (DESNZ)." },
    ],
    details: [
      "Adds £100 to the Warm Home Discount for each household that receives it in winter 2026-27.",
      "Eligibility follows England and Wales's 2026-27 core group.",
      "Scotland's scheme has its own core group, so eligibility there is approximate.",
    ],
    starts: "Winter 2026-27",
    affects: "Households on means-tested benefits",
    type: "Benefit",
    inForce: { from: "2026-10", to: "2027-03" },
    ends: "After one winter",
    duration: "One winter",
    source: {
      label: "Warm Home Discount",
      href: "https://www.gov.uk/the-warm-home-discount-scheme",
    },
  },
  {
    id: "domestic_electricity_zero_vat",
    cardOrder: 5,
    shortName: "Zero VAT on electricity",
    noun: "electricity VAT cut",
    sentence: "taking VAT off household electricity",
    name: "Zero VAT on domestic electricity",
    description: "Extend zero VAT on domestic electricity through June 2027",
    writtenFor: "The existing zero rate of VAT on domestic electricity in Great Britain is extended through 30 June 2027, with Northern Ireland included from 1 April 2027. Compared with the actual pre-Budget policy, which already zero-rated Great Britain through March 2027. The model day-weights the dated rates; gas is unchanged.",
    summary: "Extends Great Britain’s electricity zero rate and adds Northern Ireland through June 2027.",
    points: [
      {"label": "Existing relief", "text": "Great Britain’s October-to-March zero rate stays on both sides."},
      {"label": "Gas", "text": "The government leaves gas VAT unchanged."},
    ],
    details: [
      "We compare the April-to-June extension with the actual pre-Budget policy.",
      "Great Britain already had zero VAT from October 2026 through March 2027.",
      "Northern Ireland keeps 5% before the Budget policy starts in April 2027.",
      "The model weights VAT rates by days from 6 April to 5 April.",
      "We include 1–5 April 2027 in the model’s 2026-27 fiscal year.",
    ],
    starts: "Apr 2027",
    affects: "Households across the UK",
    type: "VAT",
    inForce: {"from": "2027-04", "to": "2027-06"},
    ends: "Jun 2027",
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
    writtenFor: "Candidate measure. From 6 April 2027 employers pay no secondary Class 1 National Insurance on earnings up to the upper earnings limit (£50,270) for employees under 25, extending the under-21 relief to ages 21 to 24. Wages are held fixed, so it changes revenue, not household incomes. The data carry an apprentice indicator; its presence alone does not establish its variation or accuracy. Apprentices keep the model's existing employer NI treatment.",
    summary: "Employers pay no National Insurance on earnings up to £50,270 for under-25s.",
    points: [
      { label: "Extends", text: "The under-21 relief to ages 21 to 24." },
      { label: "Households", text: "No change in household incomes: wages are held fixed." },
    ],
    details: [
      "Relieves employers' secondary Class 1 National Insurance up to the upper earnings limit.",
      "The policy changes revenue only, so the household charts show no change.",
    ],
    starts: "April 2027",
    type: "National Insurance",
    inForce: { from: "2027-04" },
  },
  {
    id: "threshold_freeze_2031_32",
    shortName: "Threshold freeze",
    sentence: "freezing the income tax thresholds for 2031-32",
    name: "Threshold freeze to 2031-32",
    description: "Keep income tax thresholds frozen in 2031-32",
    writtenFor: "Candidate measure. The income tax personal allowance stays at £12,570 and the basic rate band at £37,700 (a higher rate threshold of £50,270) for one more year, 2031-32, instead of rising with inflation to £12,830 and £38,500. From 2031-32 policyengine-uk sets the National Insurance primary threshold and upper earnings limit at the personal allowance and higher rate threshold, so they stay at £12,570 and £50,270 too; the employer secondary threshold is not held.",
    summary: "Keeps income tax thresholds frozen for one more year, 2031-32.",
    points: [
      { label: "Personal allowance", text: "£12,570, instead of £12,830." },
      { label: "Basic rate band", text: "£37,700, instead of £38,500." },
      { label: "National Insurance", text: "The primary threshold and upper earnings limit stay frozen too." },
    ],
    details: [
      "Holds the personal allowance and basic rate band in 2031-32 instead of uprating them.",
      "The model ties those National Insurance thresholds to the personal allowance and higher rate threshold from 2031-32.",
      "The freeze doesn't cover the employer threshold.",
      "The assumption of an extra year of the freeze predates the Budget.",
      "Assumption: incomes stay fixed, with no behavioural response.",
    ],
    starts: "April 2031",
    affects: "Income taxpayers, and workers paying National Insurance",
    type: "Income tax",
    inForce: { from: "2031-04" },
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
    summary: "Halves the Business Asset Disposal Relief lifetime limit, from £1 million to £500,000.",
    points: [
      { label: "Relief rate", text: "Stays at 18%." },
      { label: "Above the limit", text: "Gains pay the main capital gains tax rates." },
    ],
    details: [
      "The assumption of a £500,000 limit predates the Budget.",
      "The model applies the limit to each year's gains, as if no earlier gains had used it.",
      "The figure is the extra tax on each year's disposals.",
      "Taxpayers pay most of it in the January after the tax year ends.",
    ],
    starts: "April 2027",
    type: "Capital gains tax",
    inForce: { from: "2027-04" },
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
    summary: "Cuts VAT on petrol and diesel from 20% to 15%.",
    points: [
      { label: "Pump prices", text: "Assumed fully passed through to pump prices." },
      { label: "Assumption", text: "We set the rate and dates before the Budget." },
    ],
    details: [
      "Applies 15% VAT instead of 20% to households' petrol and diesel spending, day-weighted to fiscal years.",
    ],
    starts: "December 2026",
    affects: "Households buying petrol or diesel",
    type: "VAT",
    inForce: { from: "2026-12", to: "2027-05" },
    ends: "May 2027",
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
    summary: "Raises the Plan 2 repayment threshold with RPI, ending its freeze at £29,385.",
    points: [
      { label: "In 2027-28", text: "The threshold is £30,267." },
      { label: "Freeze ends", text: "It was due to last to April 2030." },
    ],
    details: [
      "Models each graduate's Plan 2 repayments from their income, replacing the repayments the survey reports.",
      "The revenue figure is the change in graduates' cash repayments each year.",
      "It is not the effect on public sector borrowing, which treats changes to loan terms differently.",
    ],
    starts: "April 2027",
    affects: "Graduates repaying Plan 2 student loans",
    type: "Student loans",
    inForce: { from: "2027-04" },
    source: {
      label: "Repaying your student loan",
      href: "https://www.gov.uk/repaying-your-student-loan/what-you-pay",
    },
  },
  {
    id: "carers_allowance_earnings_taper",
    cardOrder: 2,
    shortName: "Carer's Allowance taper",
    noun: "Carer's Allowance taper",
    sentence: "tapering Carer's Allowance above the earnings limit",
    name: "Carer's Allowance earnings taper",
    description: "Withdraw Carer's Allowance £1 for £1 above the earnings limit",
    writtenFor: "In England and Wales, Carer's Allowance no longer stops when weekly net earnings pass the Weekly Earnings Limit, 16 hours at the National Living Wage (£212 a week at April 2027's £13.21, rounded up to the pound): it is reduced by £1 for each £1 of earnings above the limit, a 100% taper, to nothing once earnings exceed the limit by the full weekly rate. The native model uses a provisional start of 6 October 2030 until DWP confirms the date within 2030-31. Carers at or below the limit and Scotland's Carer Support Payment are unchanged. The native model applies the couple election, overlapping-benefit rules, income tax and Universal Credit interactions; take-up follows the data.",
    summary: "Tapers Carer's Allowance away, £1 for each £1 earned above the earnings limit.",
    points: [
      { label: "Earnings limit", text: "16 hours at the National Living Wage, rounded up to the pound." },
      { label: "Unchanged", text: "Carers at or below the limit; Scotland's Carer Support Payment." },
    ],
    details: [
      "The native model provisionally starts the taper on 6 October 2030.",
      "DWP has committed to a start within 2030-31 and has not confirmed the date.",
      "The model applies couple elections and overlapping-benefit rules.",
      "We include income tax and Universal Credit interactions.",
      "Take-up follows the data; it does not assume every newly eligible carer claims.",
    ],
    starts: "Oct 2030 (planned)",
    affects: "Carers in England and Wales earning above the limit",
    type: "Benefit",
    inForce: {"from": "2030-10"},
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
    summary: "Re-sets Local Housing Allowance rates to local rents each April, ending the freeze.",
    points: [
      { label: "New rate", text: "The 30th percentile of local rents." },
      { label: "Frozen since", text: "April 2024." },
      { label: "Who gains", text: "Private renters on Universal Credit or Housing Benefit." },
      { label: "Northern Ireland", text: "Its rates follow Great Britain's, so the freeze ends there too." },
    ],
    details: [
      "policyengine-uk projects each area's rents, so the size of the re-set comes from the model, not a publication.",
      "Keeps the national maximum and the March 2020 minimum.",
      "Only renters whose rent exceeds the frozen rate gain.",
      "The benefit cap still applies, so a household at the cap gains less or nothing.",
    ],
    starts: "April 2027",
    type: "Benefit",
    inForce: { from: "2027-04" },
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
    summary: "Raises the employer National Insurance threshold from £5,000 back to £9,100 a year.",
    points: [
      { label: "Rate", text: "15%, unchanged." },
      { label: "Uprating", text: "Rises with CPI from 2031-32, as current law's does." },
      { label: "Employees", text: "The saving reaches them as higher pay." },
    ],
    details: [
      "Sets the employer threshold at £9,100 a year (£175 a week) from 2027-28.",
      "The assumption of a £9,100 threshold predates the Budget.",
      "policyengine-uk holds each employer's total cost of employment fixed, so the saving reaches employees as wages that year.",
      "Income tax and employee National Insurance are then due on the higher wages.",
    ],
    starts: "April 2027",
    affects: "Employers, and their employees through pay",
    type: "National Insurance",
    inForce: { from: "2027-04" },
    source: {
      label: "National Insurance Contributions (Secondary Class 1 Contributions) Act 2025, section 2",
      href: "https://www.legislation.gov.uk/ukpga/2025/11/section/2",
    },
  },
  {
    id: "property_income_rates_up",
    cardOrder: 6,
    shortName: "Property income tax up",
    noun: "property income tax rise",
    sentence: "raising tax on property income",
    name: "Property income tax rates up",
    description: "Raise income tax on property income by 2 points",
    writtenFor: "From 6 April 2027 the income tax rates on property income rise to 24%, 44% and 49% at the basic, higher and additional rates in England, Wales and Northern Ireland: 2 percentage points above pre-Budget policy, which includes Budget 2025's rises. Finance cost relief for landlords follows the property basic rate, so rises to 24%, Scottish landlords' included. Incomes are held fixed, with no behavioural response.",
    summary: "Raises income tax on property income by 2 points, outside Scotland.",
    points: [
      { label: "On top of", text: "The rises Budget 2025 legislated." },
      { label: "Scotland", text: "Scottish rates apply to property income, so they don't change." },
      { label: "Scottish landlords", text: "Finance cost relief rises to 24%, so slightly less tax." },
    ],
    details: [
      "Adds 2 points to each property income rate from 2027-28: 24%, 44% and 49% at basic, higher and additional.",
      "Finance cost relief follows the UK property basic rate, including for Scottish landlords.",
      "Assumption: incomes stay fixed; no one changes how they hold property.",
    ],
    starts: "Apr 2027",
    affects: "People with rental income",
    type: "Income tax",
    inForce: { from: "2027-04" },
    // Budget 2026's policy paper (HMRC, 29 October 2026), as the savings
    // card's; the card linked Budget 2025's, on the rises this one adds to
    source: {
      label: "HMRC: Income Tax: changes to tax rates for property and savings income",
      href: "https://www.gov.uk/government/publications/income-tax-changes-to-tax-rates-for-property-and-savings-income",
    },
    budgetRows: [61],
    visual: { kind: "property-rates", place: "change", where: "England, Wales and Northern Ireland" },
  },
  {
    id: "savings_income_rates_up",
    cardOrder: 8,
    shortName: "Savings income tax up",
    noun: "savings income tax rise",
    sentence: "raising tax on savings income",
    name: "Savings income tax rates up",
    description: "Raise income tax on savings income by 2 points",
    writtenFor: "From 6 April 2027 the income tax rates on savings income rise to 24%, 44% and 49% at the basic, higher and additional rates across the UK: 2 percentage points above pre-Budget policy, which already includes Budget 2025's rises. Dividend rates are unchanged. Incomes are held fixed, with no behavioural response.",
    summary: "Raises income tax on savings income across the UK by 2 points.",
    points: [
      { label: "New rates", text: "24%, 44% and 49% at basic, higher and additional." },
      { label: "On top of", text: "The rises Budget 2025 legislated." },
      { label: "Unchanged", text: "Dividend rates." },
    ],
    details: [
      "Adds 2 points to each savings income rate from 2027-28.",
      "UK rates apply to savings income, including in Scotland.",
      "Assumption: incomes stay fixed; no one changes how they hold savings.",
    ],
    starts: "Apr 2027",
    affects: "People with savings interest",
    type: "Income tax",
    inForce: { from: "2027-04" },
    // Budget 2026's policy paper (HMRC, 29 October 2026); the card linked
    // Budget 2025's, on the rises this one adds to
    source: {
      label: "HMRC: Income Tax: changes to tax rates for property and savings income",
      href: "https://www.gov.uk/government/publications/income-tax-changes-to-tax-rates-for-property-and-savings-income",
    },
    budgetRows: [62],
  },
  {
    id: "household_energy_payment_2026",
    cardOrder: 3,
    shortName: "Energy payment",
    noun: "energy payment",
    sentence: "paying £100 towards energy bills",
    name: "Household Energy Payment",
    description: "Pay £100 to households in council tax bands A to D in England this winter",
    writtenFor: "A one-off £100 payment from January 2027 to each household in England in property valuation bands A to D (the lowest four of England's eight), up to 20 million households, paid into bank accounts and counted as household income in 2026-27. Scotland, Wales and Northern Ireland receive a share of the funding instead, which is not modelled.",
    summary: "Pays £100 once into each eligible household's bank account.",
    points: [
      { label: "Counts as", text: "Household income in 2026-27." },
      { label: "Elsewhere", text: "Scotland, Wales and Northern Ireland get a share of the funding." },
    ],
    details: [
      "We add £100 to eligible English households’ income in 2026-27.",
      "We include the payment in HBAI poverty income and in household net income.",
      "The official costing also covers funding for the devolved governments, which our household simulation leaves out.",
      "We also leave out the £100 million for councils in England for targeted support.",
    ],
    starts: "Jan 2027",
    affects: "Households in England in council tax bands A to D",
    type: "Payment",
    inForce: { from: "2027-01", to: "2027-03" },
    ends: "After one winter",
    duration: "One winter",
    source: {
      label: "Budget 2026",
      href: "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html",
    },
    budgetRows: [1],
    example: {
      title: "Who it reaches",
      text: "Up to 20 million households in England (about 80%), including:",
      items: [
        "83% of households spending over a tenth of their income after housing costs on energy",
        "88% of households in the bottom three income deciles",
      ],
      // "Fuel stressed" (footnote 84): spending over 10% of income after
      // housing costs on energy
      source: { label: "Budget 2026, paragraphs 3.5 and 3.6", href: "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html" },
    },
    visual: {
      kind: "energy-reach",
      place: "example",
      bands: "ABCDEFGH",
      reach: {
        millions: 20,
        share: 0.8,
        groups: [
          { label: "Spending over a tenth of their income after housing costs on energy", share: 0.83 },
          { label: "In the bottom three income deciles", share: 0.88 },
        ],
      },
    },
  },
  {
    id: "trading_allowance_raise",
    cardOrder: 4,
    shortName: "Trading allowance",
    noun: "trading allowance rise",
    sentence: "raising the trading allowance",
    name: "Trading allowance raised to £3,000",
    description: "Raise the trading allowance from £1,000 to £3,000",
    writtenFor: "From 6 April 2027 the government raises the trading allowance from £1,000 to £3,000, for income tax and Class 4 National Insurance. The native model shares the allowance across trading receipts and eligible miscellaneous income, considers actual expenses and uses recorded claim status. We cannot estimate its national effect on the certified data, which lack trading-allowance claim status and eligible miscellaneous income.",
    summary: "Raises the trading allowance from £1,000 to £3,000.",
    points: [
      { label: "What it does", text: "Relieves trading receipts in place of actual expenses." },
      { label: "Covers", text: "Income tax and Class 4 National Insurance." },
    ],
    details: [
      "The government raises one allowance shared across trading receipts and eligible miscellaneous income.",
      "The native model considers actual expenses and recorded trading-allowance claim status.",
      "The certified data lack claim status and eligible miscellaneous income.",
      "We cannot publish a national estimate on these data.",
      "The official cash-receipts costing starts in 2028-29; the tax-year policy starts in 2027-28.",
    ],
    starts: "Apr 2027",
    affects: "Sole traders with trading income or expenses under £3,000",
    type: "Income tax",
    inForce: { from: "2027-04" },
    source: {
      label: "Budget 2026",
      href: "https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html",
    },
    budgetRows: [15],
  },
  {
    id: "bus_fare_cap_2027",
    cardOrder: 9,
    shortName: "Bus fare cap",
    noun: "bus fare cap",
    sentence: "capping single bus fares at £2",
    name: "Single bus fares capped at £2",
    description: "Retain the £2 single bus fare cap outside London in 2027",
    writtenFor: "Single bus fares on participating services in England outside London are capped at £2 from 1 January to 31 December 2027. DfT announced this cap in July 2026, before the Autumn Budget, so the actual pre-Budget and current-law scenarios both retain it. Its incremental Budget effect is zero on this reference. London is outside the national cap.",
    summary: "We retain the £2 cap on both sides of this comparison.",
    points: [
      {"label": "Budget effect", "text": "No additional change against the pre-Budget policy."},
      {"label": "Coverage", "text": "Participating services in England outside London."},
    ],
    details: [
      "DfT announced the £2 cap for 2027 on 22 July 2026.",
      "We retain that cap through December 2027 on both sides.",
      "The comparison adds no household income or fare saving for this measure.",
    ],
    starts: "Jan 2027",
    affects: "Bus passengers in England outside London",
    type: "Transport",
    inForce: { from: "2027-01", to: "2027-12" },
    ends: "Dec 2027",
    source: {"label": "£2 bus fares from January 2027", "href": "https://www.gov.uk/government/speeches/2-bus-fares-from-january-2027"},
    budgetRows: [4],
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

/**
 * A catalogue measure as a noun after "the" in a sentence: its entry's
 * noun, else its short name with its first letter lowered ("Threshold
 * freeze" to "threshold freeze"). A name with a capital after its first
 * letter keeps its capitals ("BADR cut", "Warm Home Discount top-up",
 * "Carer's Allowance earnings taper"), as in ProgrammeTable's inSentence.
 * The fallback runs whenever an entry's `writtenFor` stops matching the
 * publication, so it must not lower a proper name.
 */
export function nounOf(measure) {
  const noun = policyDetailsFor(measure)?.noun;
  if (noun) return noun;
  const name = String(shortNameOf(measure) ?? "");
  return /[A-Z]/.test(name.slice(1)) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}
