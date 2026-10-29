import { businessMiles } from "./householdImpactApi";

/**
 * Measures the Household calculator adds to a household's request that are
 * not in the national results: not in the manifest, the page header's
 * policy selector, the charts, the maps or the combined package. The
 * household API still knows them, so one household can be calculated with
 * them.
 *
 * The savings income tax rise is held back from the national results while
 * the savings data are corrected (María, #290, 28 October 2026); Vahid and
 * María agreed it goes in the calculator only, and it is always included
 * there (Vahid, 28 October). It is in the API's reform registry.
 *
 * The tax-free mileage rates rise (#357) has no national figure at all:
 * neither the survey data nor the model has business mileage. The API
 * applies it to the business miles a household enters, as a measure of
 * the household calculation alone, and the page adds it to a request only
 * when the answers have business miles (`appliesTo`), so every other
 * household's request, and every example's precomputed answer, is as
 * before.
 *
 * This is the one place the page names them outside the measure catalogue.
 */
export const SAVINGS_INCOME_RATES_ID = "savings_income_rates_up";
export const MILEAGE_RATES_ID = "mileage_rates_raise";

export const CALCULATOR_ONLY_MEASURES = {
  [SAVINGS_INCOME_RATES_ID]: {
    id: SAVINGS_INCOME_RATES_ID,
    name: "Savings income tax up",
    // As the result card names it after the count ("with 7 policies and …")
    phrase: "the savings income tax rise",
  },
  [MILEAGE_RATES_ID]: {
    id: MILEAGE_RATES_ID,
    name: "Tax-free mileage rates up",
    phrase: "the tax-free mileage rates rise",
    // Only for a household that drives for work: without miles it cannot
    // change anything
    appliesTo: (inputs) => businessMiles(inputs) > 0,
  },
};

const CALCULATOR_ONLY_IDS = Object.keys(CALCULATOR_ONLY_MEASURES);

export const isCalculatorOnly = (id) => Object.hasOwn(CALCULATOR_ONLY_MEASURES, id);

// Whether a calculator-only measure goes in a request with these answers:
// always, unless it reads them (`appliesTo`); never then without answers
const appliesFor = (id, inputs) => {
  const { appliesTo } = CALCULATOR_ONLY_MEASURES[id];
  return !appliesTo || (inputs != null && appliesTo(inputs));
};

/**
 * A household request's measures: the header's selection, then every
 * calculator-only measure not already in it that applies to the answers
 * `inputs` (with none given, as for the examples, only those that always
 * apply). With nothing selected, nothing (no request is made then).
 */
export const withCalculatorOnly = (policies, inputs = null) =>
  policies.length === 0
    ? []
    : [...policies, ...CALCULATOR_ONLY_IDS.filter((id) => !policies.includes(id) && appliesFor(id, inputs))];

/** The measures without the calculator-only ones (for the national figures). */
export const withoutCalculatorOnly = (policies) => policies.filter((id) => !isCalculatorOnly(id));

/** Names in a sentence: "a", "a and b", "a, b and c". */
export const listInWords = (names) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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
  return { count, named, text: listInWords(parts) };
}
