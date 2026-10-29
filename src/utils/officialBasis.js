import contract from "./publication/contract.json";

/**
 * What ours on the official costing's basis counts (#297), in words. The
 * ring is named by what it counts, never "the official costing's basis":
 * the Carer's Allowance taper's official figure also holds Scotland's block
 * grant, and the Pension Tax Allowance's small Scottish and departmental
 * lines (Pavel, 29 Oct). The variables are the ones the generator sums for
 * each measure (calculators.OFFICIAL_BASES, through the publication
 * contract), so the words cannot drift from the figure.
 */
export const VARIABLE_WORDS = {
  carers_allowance: "Carer's Allowance",
  universal_credit: "Universal Credit",
  income_tax: "income tax",
};

/** Where a row's own words are not known, as in the legend and the table's column. */
export const GENERIC_BASIS = "the official costing's taxes and benefits";

/**
 * What a measure's figure counts: "Carer's Allowance and Universal Credit",
 * or the generic phrase for a measure with no basis in `bases` or a
 * variable with no words.
 */
export function basisWords(id, bases = contract.official_bases ?? {}) {
  const variables = Object.hasOwn(bases, id) ? bases[id] : null;
  if (!Array.isArray(variables) || variables.length === 0 || variables.some((name) => !Object.hasOwn(VARIABLE_WORDS, name))) {
    return GENERIC_BASIS;
  }
  const words = variables.map((name) => VARIABLE_WORDS[name]);
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A measure's ring: "Ours, income tax only". */
export function basisLabel(id) {
  return `Ours, ${basisWords(id)} only`;
}

/** The ring wherever one label serves every row: the legend and the table's column. */
export const BASIS_LABEL = `Ours, ${GENERIC_BASIS} only`;
