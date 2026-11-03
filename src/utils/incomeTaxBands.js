/**
 * Income tax and employee National Insurance band by band, for the
 * household table's policy tabs (policyBreakdown.js): how much of each
 * kind of income falls in each band, and the tax on it. The tabs show it
 * only when it gives the household API's own income tax and National
 * Insurance before the measures to within £1, so a household the bands
 * here do not describe (Scotland's rates, a couple, income the form does
 * not ask about) shows no bands rather than wrong ones.
 *
 * The thresholds and rates that measures change (the personal allowance,
 * the basic rate band, the rates on savings, dividends and property
 * income) come from public/data/policy_parameters.json: its "before" is
 * current law. The rest is UK income tax law that no published measure
 * changes and that current law keeps frozen to 2031: below.
 */

// The rest of the structure (rUK income tax; Class 1 employee NI)
export const FIXED_LAW = {
  // The personal allowance falls by £1 for every £2 of income above it
  taperStart: 100000,
  // Taxable income above which the additional rate applies
  additionalThreshold: 125140,
  earnedRates: { basic: 0.2, higher: 0.4, additional: 0.45 },
  // The starting rate for savings: up to £5,000 of savings at 0%, less
  // non-savings income above the personal allowance
  savingsStartingBand: 5000,
  // The personal savings allowance, by the highest band reached
  personalSavingsAllowance: { basic: 1000, higher: 500, additional: 0 },
  dividendAllowance: 500,
  // Employee Class 1 National Insurance: the main rate between the
  // primary threshold (the personal allowance) and the upper earnings
  // limit (the higher rate threshold), the upper rate above it
  niMainRate: 0.08,
  niUpperRate: 0.02,
};

const BANDS = ["basic", "higher", "additional"];

/**
 * Income tax by band.
 *
 * @param {{earned: number, property: number, savings: number, dividends: number}} income
 *   - earned: employment income and pensions (non-savings income)
 * @param {{personalAllowance: number, basicRateBand: number, rates: Object}} law -
 *   rates: { property, savings, dividends } each { basic, higher, additional }
 * @returns {{allowance: number, slices: Array<{kind, band, rate, amount, tax}>, total: number}}
 */
export function incomeTax(income, law) {
  const amounts = {
    earned: Math.max(0, income.earned ?? 0),
    property: Math.max(0, income.property ?? 0),
    savings: Math.max(0, income.savings ?? 0),
    dividends: Math.max(0, income.dividends ?? 0),
  };
  const total = amounts.earned + amounts.property + amounts.savings + amounts.dividends;
  const allowance = Math.max(0, law.personalAllowance - Math.max(0, (total - FIXED_LAW.taperStart) / 2));
  // The allowance is set against earnings first, then property, savings
  // and dividends
  let left = allowance;
  const taxable = {};
  for (const kind of ["earned", "property", "savings", "dividends"]) {
    const used = Math.min(left, amounts[kind]);
    taxable[kind] = amounts[kind] - used;
    left -= used;
  }
  const taxableTotal = taxable.earned + taxable.property + taxable.savings + taxable.dividends;
  const limits = { basic: law.basicRateBand, higher: FIXED_LAW.additionalThreshold, additional: Infinity };
  const rates = { earned: FIXED_LAW.earnedRates, ...law.rates };

  const slices = [];
  let position = 0;
  // Fill the bands from `position`, at the kind's rates (or at 0% for an
  // allowance that still uses up the band)
  const stack = (kind, amount, zeroLabel = null) => {
    let rest = amount;
    for (const band of BANDS) {
      if (rest <= 0) break;
      const room = limits[band] - position;
      if (room <= 0) continue;
      const take = Math.min(room, rest);
      const rate = zeroLabel ? 0 : rates[kind][band];
      slices.push({ kind, band: zeroLabel ?? band, rate, amount: take, tax: take * rate });
      position += take;
      rest -= take;
    }
  };
  stack("earned", taxable.earned);
  stack("property", taxable.property);
  // Savings: the starting rate, then the personal savings allowance, then the rates
  const starting = Math.min(taxable.savings, Math.max(0, FIXED_LAW.savingsStartingBand - taxable.earned - taxable.property));
  stack("savings", starting, "starting");
  const highest = taxableTotal <= limits.basic ? "basic" : taxableTotal <= limits.higher ? "higher" : "additional";
  const psa = Math.min(taxable.savings - starting, FIXED_LAW.personalSavingsAllowance[highest]);
  stack("savings", psa, "allowance");
  stack("savings", taxable.savings - starting - psa);
  const dividendAllowance = Math.min(taxable.dividends, FIXED_LAW.dividendAllowance);
  stack("dividends", dividendAllowance, "allowance");
  stack("dividends", taxable.dividends - dividendAllowance);

  return { allowance, slices, total: slices.reduce((sum, slice) => sum + slice.tax, 0) };
}

/** Employee Class 1 National Insurance on earnings, by band. */
export function employeeNi(earnings, { primaryThreshold, upperEarningsLimit }) {
  const main = Math.max(0, Math.min(earnings, upperEarningsLimit) - primaryThreshold);
  const upper = Math.max(0, earnings - Math.max(upperEarningsLimit, primaryThreshold));
  return {
    main,
    upper,
    total: main * FIXED_LAW.niMainRate + upper * FIXED_LAW.niUpperRate,
  };
}
