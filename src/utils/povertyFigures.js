/**
 * Whether the page shows the poverty and people-affected figures: one
 * switch, off (#336).
 *
 * Off (`POVERTY_FIGURES_SHOWN = false`, from 29 October 2026), the page
 * hides every measure's poverty figure and people-affected figure, on
 * screen and in its chart downloads, pending #336 (the Household Energy
 * Payment's poverty figure, policyengine-uk#2724) and #285's floor of
 * survey households:
 *
 * - Population impact has no Poverty sub-tab; ?sub=poverty opens the
 *   default sub-tab, Public finances (bootView.js, SubTabs.jsx), and the
 *   Pre-measures forecast's Poverty sub-tab has no link to it;
 * - By age has no winners and losers shares (the share of each age group
 *   who gain or lose), and so no download of them;
 * - the household calculator's Your place tip has no share of people who
 *   move up or down a percentile, and income_mobility.csv, which only that
 *   tip reads, is not fetched; nor is the outlook prefetched for
 *   ?sub=poverty (early.js);
 * - the Methodology says the figures are withheld in place of describing
 *   them, and About this dashboard says so once.
 *
 * This is hiding, not withholding from the data: the figures are still in
 * the page's static HTML (publicationBoot's verified tables include
 * metrics and poverty_inequality), in age_impact.csv, which By age still
 * fetches, and in the published files at their URLs. Removing them from
 * those too is Vahid's decision (#349).
 *
 * Kept whatever the switch says: the Pre-measures forecast's current-law
 * poverty rates (living_standards_outlook.json: HBAI outturn, and
 * projections from Microcosm with their own floor of 100 households, not a
 * measure's effect), inequality, and every decile chart (household-decile
 * averages, already held to the floor).
 *
 * On (`true`), as before: set the constant below to true. Nothing else
 * changes; the tests under each component check both settings.
 */
export const POVERTY_FIGURES_SHOWN = false;

/** The one sentence the Methodology and About this dashboard give in their place. */
export const WITHHELD_SENTENCE = "The policies' poverty and people-affected figures are not shown while they are reviewed.";
