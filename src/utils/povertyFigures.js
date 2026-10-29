/**
 * Whether the page shows the poverty and people-affected figures: one
 * switch, off (#336).
 *
 * Off (`POVERTY_FIGURES_SHOWN = false`, from 29 October 2026), no measure's
 * poverty figure or people-affected figure reaches a reader, on screen or
 * in a download, until the floor of survey households in #285 is settled:
 *
 * - Population impact has no Poverty sub-tab; ?sub=poverty opens the
 *   default sub-tab, Public finances (bootView.js, SubTabs.jsx), and the
 *   Pre-measures forecast's Poverty sub-tab has no link to it;
 * - By age has no winners and losers shares (the share of each age group
 *   who gain or lose), and so no download of them;
 * - the household calculator's Your place tip has no share of people who
 *   move up or down a percentile;
 * - the Methodology says the figures are withheld in place of describing
 *   them, and About this dashboard says so once.
 *
 * Kept whatever the switch says: the Pre-measures forecast's current-law
 * poverty rates (living_standards_outlook.json, not a measure's effect),
 * inequality, and every decile chart (household-decile averages, already
 * held to the floor). The published files themselves are unchanged.
 *
 * On (`true`), as before: set the constant below to true. Nothing else
 * changes; the tests under each component check both settings.
 */
export const POVERTY_FIGURES_SHOWN = false;

/** The one sentence the Methodology and About this dashboard give in their place. */
export const WITHHELD_SENTENCE =
  "The policies' poverty and people-affected figures are withheld pending a disclosure review.";
