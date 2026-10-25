/**
 * Public explanations and supported years come from the approved catalogue.
 * `from` is the first year with results, which can come before the policy
 * starts: results cover every year scored.
 */

/**
 * The one modelling note written by hand: other estimates of the employer
 * NI relief, each dated and attributed (#113). Independent text, not part
 * of the receipt, shown under the measure's published description while it
 * is displayed. It holds no figure of ours, which would need a receipt
 * (review of 3d52cff, finding 3); what the data and the model leave out of
 * the measure is in its registry description, which G3 approves. A note for
 * a second measure would make this a measure list of the page's own
 * (test_the_page_keeps_no_measure_list_of_its_own); it belongs in the
 * registry and its receipts instead.
 */
export const MODELLING_NOTE = {
  id: "employer_ni_relief_under_25s",
  note: "Other estimates, gross and static like this one (no pay response and no corporation tax effect), are for 2025-26. The Resolution Foundation's £5.1bn (Take a chance on me, June 2026) scraps employer NI altogether for under-25s, with no upper limit. Tax Policy Associates' £6.2bn to £7.4bn covers 21 to 24-year-olds who are not apprentices, up to £50,270. HMRC puts the existing relief for apprentices under 25, which this cost includes for those aged 21 to 24, at about £0.57bn.",
};

export function measureModelling(catalogue) {
  return catalogue.displayable.map((measure) => ({
    ...measure,
    how: measure.description,
    note: measure.id === MODELLING_NOTE.id ? MODELLING_NOTE.note : null,
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
 * Measures the household model cannot cost, for the Methodology view's
 * "Not modelled" table. Independent text with no figures: none of them is a
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
