import { CALCULATOR_ONLY_MEASURES } from "./calculatorOnlyMeasures";
import { UNMODELLED_MEASURES } from "./unmodelledMeasures";

/**
 * The three classes a Budget policy is in, as the Policies tab shows them:
 *
 * - "population": modelled for the whole population and for any household.
 *   The manifest's published measures (utils/measureCatalogue.jsx), under
 *   "Policies we model", in every chart, the maps and the package.
 * - "household": modelled for one household only, in the Household
 *   calculator (utils/calculatorOnlyMeasures.js, the one list of them), and
 *   in no national figure.
 * - "none": not modelled at all (utils/unmodelledMeasures.js).
 *
 * A household-only measure keeps its card's words in unmodelledMeasures.js
 * (its `card` names it there), so the card moves between "Budget policies
 * we do not model" and "Policies we model for households only" by an edit
 * to calculatorOnlyMeasures.js alone.
 */
export const MEASURE_CLASSES = Object.freeze(["population", "household", "none"]);

export const HOUSEHOLD_ONLY_TITLE = "Policies we model for households only";

/** The household-only class, said plainly: the section's line under its title. */
export const householdOnlyLine = (count = 1) =>
  `Household calculator only: our survey data can't yet estimate ${count === 1 ? "its national effect" : "their national effects"}.`;

/**
 * A policy's class: published ids (the catalogue's) first, so a measure
 * we come to publish never counts as household-only too; then the
 * calculator-only ones; any other is not modelled.
 */
export function classOf(id, { published = [], calculatorOnly = CALCULATOR_ONLY_MEASURES } = {}) {
  if (published.includes(id)) return "population";
  if (Object.hasOwn(calculatorOnly, id)) return "household";
  return "none";
}

/**
 * The not-modelled list's cards (utils/unmodelledMeasures.js) by class,
 * each in the list's order:
 * - `household`: the cards of the calculator-only measures, each with its
 *   measure's id (`measure`) for the calculator link;
 * - `population`: the cards of calculator-only measures since published,
 *   shown by neither section (Policies we model has the published card);
 * - `none`: every other card.
 * With no calculator-only card, `none` is the list itself, so the page
 * reads as it did before this class.
 */
export function splitUnmodelled(measures = UNMODELLED_MEASURES, { calculatorOnly = CALCULATOR_ONLY_MEASURES, published = [] } = {}) {
  const byCard = new Map(
    Object.values(calculatorOnly)
      .filter(({ card }) => card)
      .map(({ id, card }) => [card, { id, cls: classOf(id, { published, calculatorOnly }) }]),
  );
  if (byCard.size === 0) return { population: [], household: [], none: measures };
  const cls = ({ id }) => byCard.get(id)?.cls ?? "none";
  return {
    population: measures.filter((measure) => cls(measure) === "population"),
    household: measures.filter((measure) => cls(measure) === "household").map((measure) => ({ ...measure, measure: byCard.get(measure.id).id })),
    none: measures.filter((measure) => cls(measure) === "none"),
  };
}
