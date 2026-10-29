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
    // As the result card names it after the count ("with 7 policies and …")
    phrase: "the savings income tax rise",
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

/**
 * The measures among `policies` whose answers are checked against an
 * approved definition (`definitions`): every one but a calculator-only
 * measure with none, which publishes no figures, so the API's running code
 * computes it unchecked and the calculator says it is not in the national
 * results. Once one has an approved definition (back in the national
 * results), it is checked as any other.
 */
export const definitionChecked = (policies, definitions) =>
  policies.filter((id) => !isCalculatorOnly(id) || Object.hasOwn(definitions ?? {}, id));

/**
 * The measures a household's result covers, in words: the selected ones by
 * number, then each calculator-only one by name ("7 policies and the
 * savings income tax rise"). The number matches the header's selection
 * ("All 7"), and the measures the calculator adds are named, not counted
 * in it, since the result includes them (#306). `count` and `named` say
 * the same as `text`.
 */
export function resultPolicies(policies) {
  const ids = [...new Set(policies)];
  const count = withoutCalculatorOnly(ids).length;
  const named = ids.filter(isCalculatorOnly).map((id) => CALCULATOR_ONLY_MEASURES[id].phrase);
  const parts = [...(count > 0 || named.length === 0 ? [`${count} ${count === 1 ? "policy" : "policies"}`] : []), ...named];
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return { count, named, text };
}
