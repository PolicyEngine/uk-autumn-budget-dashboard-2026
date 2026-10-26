/**
 * The example households' electricity and motor fuel spending: each the
 * average for households in its tenth of the UK by gross income, so a
 * pensioner, a young renter, a family on Universal Credit and a higher
 * earner each spend what households like theirs do.
 *
 * Source: ONS, Family Spending in the UK, financial year ending 2025,
 * Workbook 1, Table A6, "Detailed household expenditure by gross income
 * decile group", average weekly household expenditure (£): line 4.4.1
 * Electricity and line 7.2.2 Petrol, diesel and other motor oils; the lower
 * boundary of each tenth (gross weekly household income, £).
 * https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends
 *
 * Line 7.2.2 is petrol and diesel together: it is split by their shares of
 * the all-household average in Table A1 (petrol £11.90 and diesel £6.50 of
 * £18.40 a week). The form asks no gas: the household API models none.
 *
 * Each example's tenth: its gross income in its first year (2027-28, from
 * the household API: earnings, pensions and cash benefits, not free
 * childcare hours), a week, against Table A6's FYE 2025 boundaries. A year's
 * spending is the weekly figure × 52, rounded to £10.
 */

/** Table A6 (FYE 2025): each tenth's lower boundary and weekly spending (£). */
export const SPENDING_BY_GROSS_INCOME_DECILE = Object.freeze([
  { decile: 1, from: 0, electricity: 14.7, motorFuel: 6.1 },
  { decile: 2, from: 304, electricity: 17.1, motorFuel: 8.2 },
  { decile: 3, from: 471, electricity: 17.5, motorFuel: 12.6 },
  { decile: 4, from: 620, electricity: 19.4, motorFuel: 17.6 },
  { decile: 5, from: 772, electricity: 20.3, motorFuel: 18.7 },
  { decile: 6, from: 940, electricity: 19.6, motorFuel: 20.7 },
  { decile: 7, from: 1122, electricity: 20.7, motorFuel: 23.1 },
  { decile: 8, from: 1359, electricity: 21.5, motorFuel: 25.9 },
  { decile: 9, from: 1669, electricity: 22.5, motorFuel: 25.4 },
  { decile: 10, from: 2280, electricity: 26.7, motorFuel: 26.1 },
]);

/** Petrol's share of line 7.2.2 for all households (Table A1: £11.90 of £18.40). */
export const PETROL_SHARE = 11.9 / 18.4;

const ORDINALS = ["", "lowest", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "highest"];
const yearly = (weekly) => Math.round((weekly * 52) / 10) * 10;

/**
 * An example's spending a year from its tenth: { electricity, petrol,
 * diesel, source } (source: one line for the result's "Based on").
 */
export function decileSpending(decile) {
  const row = SPENDING_BY_GROSS_INCOME_DECILE[decile - 1];
  if (!row) throw new Error(`No tenth ${decile}`);
  const fuel = row.motorFuel * 52;
  const petrol = Math.round((fuel * PETROL_SHARE) / 10) * 10;
  const diesel = Math.round((fuel * (1 - PETROL_SHARE)) / 10) * 10;
  return {
    electricity: yearly(row.electricity),
    petrol,
    diesel,
    source: `The average for households in the ${ORDINALS[decile]} tenth by gross income (ONS Family Spending, FYE 2025, Table A6)`,
  };
}

/** The tenth (1 to 10) of a gross weekly household income, on Table A6's boundaries. */
export function grossIncomeDecile(weekly) {
  let found = 1;
  for (const row of SPENDING_BY_GROSS_INCOME_DECILE) if (weekly >= row.from) found = row.decile;
  return found;
}

/** The form's spending answers for a tenth. */
export function spendingInputs(decile) {
  const { electricity, petrol, diesel } = decileSpending(decile);
  return {
    electricity_spending_per_year: electricity,
    petrol_spending_per_year: petrol,
    diesel_spending_per_year: diesel,
  };
}
