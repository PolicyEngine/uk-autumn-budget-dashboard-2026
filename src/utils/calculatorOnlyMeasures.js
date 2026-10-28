/**
 * Measures the Household calculator can add to a household's request that
 * are not in the national results: not in the manifest, the page header's
 * policy selector, the charts, the maps or the combined package. The
 * household API still knows them (its reform registry), so one household
 * can be calculated with them. Each is off until the reader turns it on.
 *
 * The savings income tax rise is held back from the release while the
 * savings data are corrected (María, #290, 28 October 2026); Vahid and
 * María agreed it goes in the calculator only. This is the one place the
 * page names it outside the measure catalogue.
 */
export const SAVINGS_INCOME_RATES_ID = "savings_income_rates_up";

export const CALCULATOR_ONLY_MEASURES = {
  [SAVINGS_INCOME_RATES_ID]: {
    id: SAVINGS_INCOME_RATES_ID,
    name: "Savings income tax up",
    note: "Held back from the national results while our savings data are corrected.",
  },
};

export const isCalculatorOnly = (id) => Object.hasOwn(CALCULATOR_ONLY_MEASURES, id);

/** The selected measures with the calculator-only ones turned on, after them. */
export const withCalculatorOnly = (policies, extras = []) => [
  ...policies,
  ...extras.filter((id) => isCalculatorOnly(id) && !policies.includes(id)),
];

/** The measures without the calculator-only ones (for the national figures). */
export const withoutCalculatorOnly = (policies) => policies.filter((id) => !isCalculatorOnly(id));
