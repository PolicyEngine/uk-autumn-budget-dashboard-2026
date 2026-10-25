/**
 * How the national run represents each measure, for the
 * Methodology view's table. Each row restates src/uk_budget_data/reforms.py
 * and the modifiers in budget_measures/: what the measure changes against
 * current law, and the first model year it changes (year 2027 means
 * 2027-28). The policy descriptions themselves stay with the Policies
 * section of Population impact; these are modelling facts only.
 *
 * `name` matches the measure's name on the page (POLICY_COLORS keys), so
 * the table's swatches are the charts' colours. A long `how` is a list: its
 * first line sums the measure up and the rest are one point each.
 */
export const MEASURE_MODELLING = [
  {
    name: "Threshold freeze to 2031-32",
    how: [
      "Holds the personal allowance and basic rate band at 2030-31 values in 2031-32; the NI thresholds tied to them are held too.",
      "From 2031-32 policyengine-uk sets the National Insurance primary threshold and upper earnings limit at the allowance and higher rate threshold, as they were frozen alongside them to 2030-31.",
      "The employer secondary threshold is not held: it rises to £5,100 as in current law.",
    ],
    sources: ["hmrc_income_tax_rates", "hmrc_ni_rates"],
    from: 2031,
  },
  {
    name: "Business Asset Disposal Relief restricted",
    how: [
      "Cuts the cap on gains the relief covers to £500,000, from £1 million (an assumed value).",
      "Capital gains are imputed and calibrated to 2024-25, when disposals were unusually high ahead of the April 2025 rise in the relief's rate.",
      "So the relief's base, and the revenue from restricting it, are likely 1.5 to 1.7 times too high.",
    ],
    from: 2027,
  },
  {
    name: "Fuel duty rises deferred",
    how: [
      "Sets the duty rate in each year to the deferred path.",
      "Weighted by days from 6 April, as the model blends it.",
      "Lowers VAT by 20% of the duty change on each litre bought.",
    ],
    from: 2026,
  },
  {
    name: "VAT cut on road fuel",
    how: [
      "Cuts VAT on petrol and diesel spending by 5 points while the cut is in force.",
      "121 days of 2026-27 and 61 of 2027-28.",
    ],
    from: 2026,
  },
  {
    name: "Zero VAT on domestic electricity",
    how: [
      "Removes the 5% VAT from electricity spending.",
      "For 182 days of 2026-27 and all of 2027-28.",
      "Gas and other reduced-rate goods are unchanged.",
    ],
    from: 2026,
  },
  {
    name: "Warm Home Discount top-up",
    how: [
      "£100 in winter 2026-27 to households on qualifying benefits, at DESNZ receipt rates (85% Pension Credit, 70% others).",
      "Qualifying benefits: Universal Credit and Pension Credit (legacy benefits are not counted), paid as a benefit.",
      "Each household's receipt is drawn as policyengine-uk will draw the Warm Home Discount (#2616).",
      "Great Britain only.",
    ],
    sources: ["desnz_whd_ia", "pe_uk_2616"],
    from: 2026,
  },
  {
    name: "State Pension income tax protection",
    how: [
      "Raises the personal allowance over State Pension age to the full new State Pension, rounded up to £10.",
      "Withdrawn £1 for £1 above it, down to the standard allowance.",
    ],
    from: 2027,
  },
  {
    name: "Employer NI relief for under-25s",
    how: [
      "Removes employer National Insurance between the secondary threshold and the upper earnings limit for employees aged 21 to 24.",
      "The model charges under-21s in full, so the existing under-21 relief is not in its baseline.",
      "The data identify no apprentices, so the cost includes 21 to 24-year-old apprentices, whose employers already pay no NI on these earnings (about £0.57bn in 2025-26, HMRC).",
      "Static and gross: no pay response and no corporation tax effect.",
      "Other estimates, also gross and static, are for 2025-26, when the model gives £5.7bn: the Resolution Foundation's £5.1bn (Take a chance on me, June 2026) scraps employer NI for all under-25s with no upper limit; Tax Policy Associates' £6.2bn to £7.4bn covers 21 to 24-year-olds who are not apprentices, up to £50,270.",
    ],
    sources: ["hmrc_employer_rates"],
    from: 2027,
  },
  {
    name: "Plan 2 student loan threshold unfrozen",
    how: [
      "Raises the Plan 2 repayment threshold with RPI from 2027-28.",
      "Repayments are modelled, replacing those reported in the survey.",
      "The revenue figure is the change in modelled repayments.",
    ],
    sources: ["student_loan_thresholds"],
    from: 2027,
  },
];

/**
 * Measures the household model cannot cost, for the Methodology view's
 * "Not modelled" table.
 */
export const NOT_MODELLED = [
  {
    name: "Business rates relief for pubs and live music venues",
    why: "Business rates are in the model only as an aggregate with no split by sector.",
  },
  {
    name: "“Your First Home” equity loans",
    why: "The model has no mortgages or equity loans, and the scheme is largely a financial transaction.",
  },
  {
    name: "Online marketplaces collecting VAT",
    why: "It is a compliance measure on sellers' unpaid VAT, which the survey does not record.",
  },
  {
    name: "Bank surcharge rise",
    why: "Corporation tax on banks is not in the household model.",
  },
];
