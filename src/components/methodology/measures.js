/**
 * Public explanations and supported years come from the approved catalogue.
 * `from` is the first year with results, which can come before the policy
 * starts: results cover every year scored.
 */
export function measureModelling(catalogue) {
  return catalogue.displayable.map((measure) => ({
    ...measure,
    how: measure.description,
    from: measure.years.filter((year) => !measure.unsupported_years.includes(year)).sort((a, b) => a - b)[0] ?? null,
  }));
}

/** Catalogue measures whose results are held, unpublished or unverified. */
export function unavailableMeasures(catalogue) {
  return catalogue.measures.filter((measure) => !measure.displayable).map((measure) => ({
    ...measure,
    why: measure.availability.reason || "Verified results are unavailable.",
  }));
}

/**
 * Measures reported as likely that the household model cannot cost, for
 * the Methodology view's "Likely but not modelled" table. Independent text
 * with no figures: none of them is a measure in the registry
 * (src/uk_budget_data/reforms.py); one that becomes modelled leaves here.
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
