/**
 * Measures the Household calculator always adds to a household's request
 * that are not in the national results: not in the manifest, the page
 * header's policy selector, the charts, the maps or the combined package.
 * The household API still knows them (its reform registry), so one
 * household can be calculated with them.
 *
 * The savings income tax rise is held back from the national results while
 * the savings data are corrected (María, #290, 28 October 2026); Vahid and
 * María agreed it goes in the calculator only, and it is always included
 * there (Vahid, 28 October). This is the one place the page names it
 * outside the measure catalogue.
 */
export const SAVINGS_INCOME_RATES_ID = "savings_income_rates_up";

export const CALCULATOR_ONLY_MEASURES = {
  [SAVINGS_INCOME_RATES_ID]: {
    id: SAVINGS_INCOME_RATES_ID,
    name: "Savings income tax up",
  },
};

const CALCULATOR_ONLY_IDS = Object.keys(CALCULATOR_ONLY_MEASURES);

export const isCalculatorOnly = (id) => Object.hasOwn(CALCULATOR_ONLY_MEASURES, id);

/**
 * A household request's measures: the header's selection, then every
 * calculator-only measure not already in it. With nothing selected, nothing
 * (no request is made then).
 */
export const withCalculatorOnly = (policies) =>
  policies.length === 0 ? [] : [...policies, ...CALCULATOR_ONLY_IDS.filter((id) => !policies.includes(id))];

/** The measures without the calculator-only ones (for the national figures). */
export const withoutCalculatorOnly = (policies) => policies.filter((id) => !isCalculatorOnly(id));
