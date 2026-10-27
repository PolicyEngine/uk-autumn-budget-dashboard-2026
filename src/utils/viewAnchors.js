/**
 * Anchors that the page's shell (App.jsx, PopulationImpactView) links to,
 * kept apart from the cards that carry them so the shell does not import
 * those cards' code, and with it the chart library, before a view opens.
 */

/** The young people section's anchor: link to it as #young-people. */
export const YOUNG_PEOPLE_ANCHOR = "young-people";

/** The current-law growth card's id, which its twin with the measures links to. */
export const GROWTH_CURRENT_LAW_ANCHOR = "growth-current-law";
