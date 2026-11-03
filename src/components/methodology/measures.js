/**
 * The Methodology view's list of measures without verified results. What
 * each published measure does and how it is modelled is on the Policies tab
 * (src/utils/measureModelling.js), and the Budget measures the dashboard
 * does not model are at its foot (src/utils/unmodelledMeasures.js).
 */

/** Catalogue measures whose results are held, unpublished or unverified. */
export function unavailableMeasures(catalogue) {
  return catalogue.measures.filter((measure) => !measure.displayable).map((measure) => ({
    ...measure,
    why: measure.availability.reason || "Verified results are unavailable.",
  }));
}
