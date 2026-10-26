/**
 * The Methodology view's lists of measures it says something about as
 * method: those without verified results, and those the model cannot cost.
 * What each published measure does and how it is modelled is on the
 * Policies tab (src/utils/measureModelling.js).
 */

/** Catalogue measures whose results are held, unpublished or unverified. */
export function unavailableMeasures(catalogue) {
  return catalogue.measures.filter((measure) => !measure.displayable).map((measure) => ({
    ...measure,
    why: measure.availability.reason || "Verified results are unavailable.",
  }));
}

/**
 * Measures the household model cannot cost, for the Methodology view's
 * "Not modelled" list. Independent text with no figures: none of them is a
 * measure in the registry (src/uk_budget_data/reforms.py); one that becomes
 * modelled leaves here.
 */
export const NOT_MODELLED = [
  {
    name: "Business rates relief for pubs and live music venues",
    why: "Business rates are in the model only as an aggregate with no split by sector.",
  },
  {
    name: "“Your First Home” equity loans",
    why: "The model has no mortgages or equity loans, and the scheme is largely a financial transaction.",
  },
  {
    name: "Online marketplaces collecting VAT",
    why: "It is a compliance measure on sellers' unpaid VAT, which the survey does not record.",
  },
  {
    name: "Bank surcharge rise",
    why: "Corporation tax on banks is not in the household model.",
  },
];
