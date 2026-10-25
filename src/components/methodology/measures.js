/**
 * Public explanations and supported years come from the approved catalogue.
 * `from` is the first year with results, which can come before the policy
 * starts: results cover every year scored.
 */

/**
 * The one modelling note written by hand: the employer NI relief's scope
 * against other estimates (#113). Independent text, not part of the
 * receipt, shown under the measure's published description while it is
 * displayed. A note for a second measure would make this a measure list
 * of the page's own (test_the_page_keeps_no_measure_list_of_its_own); it
 * belongs in the registry and its receipts instead.
 */
export const MODELLING_NOTE = {
  id: "employer_ni_relief_under_25s",
  note: "Removes employer National Insurance on earnings between the secondary threshold and the upper earnings limit for employees aged 21 to 24. The model charges under-21s in full, so the existing under-21 relief is not in its baseline. The data identify no apprentices, so the cost includes 21 to 24-year-old apprentices, whose employers already pay no NI on these earnings (HMRC puts that relief at about £0.57bn in 2025-26). The figure is static and gross: no pay response and no corporation tax effect. Other estimates, also gross and static, are for 2025-26: on that year's earnings the model gives £5.7bn. The Resolution Foundation's £5.1bn (Take a chance on me, June 2026) scraps employer NI altogether for under-25s, with no upper limit. Tax Policy Associates' £6.2bn to £7.4bn covers 21 to 24-year-olds who are not apprentices, up to £50,270.",
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
