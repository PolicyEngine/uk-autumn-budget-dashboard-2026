/**
 * What ours on the official costing's basis counts (#297), in words. The
 * ring is named by what it counts, never "the official costing's basis":
 * the Carer's Allowance taper's official figure also holds Scotland's block
 * grant, and the Pension Tax Allowance's small Scottish and departmental
 * lines (Pavel, 29 Oct). The variables are the ones the generator summed
 * for the figure (calculators.OFFICIAL_BASES), from the published table's
 * own `variables` column, so the words cannot drift from the figure and
 * the page names no measure.
 */
export const VARIABLE_WORDS = {
  carers_allowance: "Carer's Allowance",
  universal_credit: "Universal Credit",
  income_tax: "income tax",
};

/** Where a figure's own words are not known, as in the legend and the table's column. */
export const GENERIC_BASIS = "the official costing's taxes and benefits";

/** The variables a table row names ("carers_allowance;universal_credit"), as a list; none for anything else. */
export function basisVariables(text) {
  return typeof text === "string" ? text.split(";").map((name) => name.trim()).filter(Boolean) : [];
}

/**
 * What a figure counts, from its variables: "Carer's Allowance and
 * Universal Credit", or the generic phrase where there are none or one has
 * no words.
 */
export function basisWords(variables) {
  const names = Array.isArray(variables) ? variables : basisVariables(variables);
  if (names.length === 0 || names.some((name) => !Object.hasOwn(VARIABLE_WORDS, name))) return GENERIC_BASIS;
  const words = names.map((name) => VARIABLE_WORDS[name]);
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A figure's ring: "Ours, income tax only". */
export function basisLabel(variables) {
  return `Ours, ${basisWords(variables)} only`;
}

/** The ring wherever one label serves every row: the legend and the table's column. */
export const BASIS_LABEL = `Ours, ${GENERIC_BASIS} only`;
