/**
 * How the national run represents each measure, for the Methodology view's
 * table. Each row restates src/uk_budget_data/reforms.py: what the measure's
 * baseline or modifier changes, and the first model year it changes
 * (year 2027 means 2027-28). The policy descriptions themselves stay with
 * the Policies section of Population impact; these are modelling facts only.
 *
 * `name` matches the measure's name on the page (POLICY_COLORS keys), so
 * the table's swatches are the charts' colours.
 */
export const MEASURE_MODELLING = [
  {
    name: "2 child limit repeal",
    how: "The baseline restores the two-child limit in Universal Credit and Child Tax Credit.",
    from: 2026,
  },
  {
    name: "Fuel duty freeze extension",
    how: "The baseline sets the pre-Budget petrol and diesel duty rates, which rise with RPI from 2027-28.",
    from: 2026,
  },
  {
    name: "Rail fares freeze",
    how: "Not modelled from fares. The Treasury's cost estimate for each year is added to households' rail subsidy, shared out by their rail spending. 2031-32 has no Treasury figure, so it holds 2030-31's cost, an assumption flagged for review.",
    from: 2026,
  },
  {
    name: "Threshold freeze extension",
    how: "The baseline raises the personal allowance and the basic-rate band with CPI. No other threshold is changed in the model.",
    from: 2028,
  },
  {
    name: "Dividend tax increase (+2pp)",
    how: "The baseline sets the pre-Budget basic and higher dividend rates, from the first full fiscal year of the rise.",
    from: 2027,
  },
  {
    name: "Savings income tax increase (+2pp)",
    how: "The baseline sets the pre-Budget savings rates, from the first full fiscal year of the rise.",
    from: 2028,
  },
  {
    name: "Property income tax increase (+2pp)",
    how: "The baseline sets the pre-Budget property income rates, from the first full fiscal year of the rise.",
    from: 2028,
  },
  {
    name: "Freeze student loan repayment thresholds",
    how: "The baseline raises the Plan 2 threshold with RPI. Repayments are modelled, replacing those reported in the survey, and the revenue figure is the change in modelled repayments.",
    from: 2027,
  },
  {
    name: "Salary sacrifice cap",
    how: "The baseline has no cap. The only measure with a behavioural assumption, described in its policy note.",
    from: 2029,
  },
];
