/**
 * How the national run represents each candidate measure, for the
 * Methodology view's table. Each row restates src/uk_budget_data/reforms.py
 * and budget_measures.py: what the measure changes against current law,
 * and the first model year it changes (year 2027 means 2027-28). The
 * policy descriptions themselves stay with the Policies section of
 * Population impact; these are modelling facts only.
 *
 * `name` matches the measure's name on the page (POLICY_COLORS keys), so
 * the table's swatches are the charts' colours.
 */
export const MEASURE_MODELLING = [
  {
    name: "Threshold freeze to 2031-32",
    how: "Sets the 2031-32 personal allowance and basic rate band to their 2030-31 values. No other threshold is changed.",
    from: 2031,
  },
  {
    name: "Business Asset Disposal Relief restricted",
    how: "Sets the relief's lifetime limit to £500,000 (an assumed value). The model applies it to each year's qualifying gains, as if none of the limit had been used before; capital gains are imputed.",
    from: 2027,
  },
  {
    name: "Salary sacrifice cap from 2028",
    how: "Sets the £2,000 cap for 2028-29 as well as later years. The behavioural assumption is described in its policy note.",
    from: 2028,
  },
  {
    name: "Fuel duty rises deferred",
    how: "Sets the duty rate in each year to the deferred path, weighted by days from 6 April as the model blends it, and lowers VAT by 20% of the duty change on each litre bought. Fuel spending is held fixed.",
    from: 2026,
  },
  {
    name: "VAT cut on road fuel",
    how: "Lowers VAT on petrol and diesel spending by 5 points for the days the cut is in force in each fiscal year (121 days of 2026-27, 61 of 2027-28), with spending held fixed.",
    from: 2026,
  },
  {
    name: "Zero VAT on domestic electricity",
    how: "Removes the 5% VAT from electricity spending: for 182 days of 2026-27 and all of 2027-28. Gas and other reduced-rate goods are unchanged.",
    from: 2026,
  },
  {
    name: "Warm Home Discount top-up",
    how: "Adds £100 to households in Great Britain receiving Universal Credit or Pension Credit in 2026-27, as a benefit. There is no high-cost-to-heat test, and legacy benefits are not counted.",
    from: 2026,
  },
  {
    name: "State Pension income tax protection",
    how: "Gives people over State Pension age a personal allowance of the full new State Pension, rounded up to £10, withdrawn £1 for £1 above it down to the standard allowance.",
    from: 2027,
  },
  {
    name: "Employer NI relief for under-25s",
    how: "Removes employer National Insurance on earnings between the secondary threshold and the upper earnings limit for employees aged 21 to 24. The model charges under-21s in full, so the existing under-21 relief is not in its baseline; apprentices are not identified.",
    from: 2027,
  },
  {
    name: "Plan 2 student loan threshold unfrozen",
    how: "Sets the Plan 2 threshold to rise with RPI from 2027-28. Repayments are modelled, replacing those reported in the survey, and the revenue figure is the change in modelled repayments.",
    from: 2027,
  },
];

/**
 * Measures reported as likely that the household model cannot cost, for
 * the Methodology view's "Likely but not modelled" table.
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
