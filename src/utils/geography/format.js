/**
 * Words and numbers for results by area, from the published strings.
 *
 * Figures keep exactly the digits the layer published: a float artefact
 * such as the ".0" in "120.0" is dropped, and nothing is ever added. This
 * is why these figures do not follow the page's two-decimal rule. A ratio
 * becomes a percentage by moving its decimal point two places, on the
 * string, so no floating-point digits appear.
 */

import { groupThousands, parseDecimal, shiftDecimal } from "./decimal";

/** A true minus sign, as the page's other figures use. */
const MINUS = "\u2212";

export const OUTCOME_LABELS = Object.freeze({
  average_change: "£ per household",
  relative_change: "% of income",
});

/** Long descriptions of what each outcome measures. */
export const OUTCOME_DESCRIPTIONS = Object.freeze({
  average_change:
    "Average change in household net income, in £ per household per year",
  relative_change:
    "Average change in household net income, as a percentage of baseline household net income",
});

export const TIER_LABELS = Object.freeze({
  reported: "Reported",
  approximate: "Approximate",
  withheld: "Not published",
});

/** What each tier means, for tooltips and notes. */
export const TIER_DESCRIPTIONS = Object.freeze({
  reported: "Reported",
  approximate:
    "Approximate: few survey households, so the interval understates the uncertainty",
  withheld: "Not published, to protect survey respondents' confidentiality.",
});

export const WITHHELD_NOTE = TIER_DESCRIPTIONS.withheld;

export const DIRECTION_LABELS = Object.freeze({
  gain: "Gain",
  loss: "Loss",
  too_close_to_call: "The interval includes zero",
  no_change: "No change for any surveyed household in this area",
});

/** Directions for a table column headed "Direction". */
export const DIRECTION_SHORT_LABELS = Object.freeze({
  gain: "Gain",
  loss: "Loss",
  too_close_to_call: "The interval includes zero",
  no_change: "No change",
});

export const SUPPORT_BAND_LABELS = Object.freeze({
  "<10": "Fewer than 10 survey households",
  "10–29": "10 to 29 survey households",
  "30+": "30 or more survey households",
});

/** Bands for a table column headed "Survey households". */
export const SUPPORT_BAND_SHORT_LABELS = Object.freeze({
  "<10": "Fewer than 10",
  "10–29": "10 to 29",
  "30+": "30 or more",
});

/**
 * One published figure for display: "120.0" → "+£120", "-1234.5" →
 * "−£1,234.5" (a true minus), "0.0123" → "+1.23%", "0.01" → "+1%".
 *
 * @param {"average_change"|"relative_change"} outcome
 * @param {string} text - The published string.
 * @param {{signed?: boolean}} [options] - `signed: false` drops the plus
 *   sign of a positive figure (a minus sign always stays).
 */
export function formatFigure(outcome, text, { signed = true } = {}) {
  const { negative, digits } = parseDecimal(text);
  const places = outcome === "relative_change" ? 2 : 0;
  const magnitude = groupThousands(
    shiftDecimal(text.replace(/^[+-]/, ""), places),
  );
  const zero = digits === "0";
  const sign = negative && !zero ? MINUS : signed && !zero ? "+" : "";
  if (outcome === "relative_change") return `${sign}${magnitude}%`;
  if (outcome === "average_change") return `${sign}£${magnitude}`;
  throw new Error(`unknown outcome ${outcome}`);
}

/** A 90% interval: "£10 to £30", "−0.5% to 1.2%". */
export const formatInterval = (outcome, lo, hi) =>
  `${formatFigure(outcome, lo, { signed: false })} to ${formatFigure(
    outcome,
    hi,
    { signed: false },
  )}`;

/**
 * Everything the page says about one row, as text. A withheld row has no
 * figure, interval, direction or band.
 */
export function describeRow(row) {
  if (!row) return null;
  if (row.tier === "withheld") {
    return {
      tier: TIER_LABELS.withheld,
      tierDescription: TIER_DESCRIPTIONS.withheld,
      value: null,
      interval: null,
      direction: null,
      supportBand: null,
    };
  }
  return {
    tier: TIER_LABELS[row.tier],
    tierDescription: TIER_DESCRIPTIONS[row.tier],
    value: formatFigure(row.outcome, row.value),
    interval: formatInterval(row.outcome, row.lo, row.hi),
    direction: DIRECTION_LABELS[row.direction],
    supportBand: SUPPORT_BAND_LABELS[row.supportBand],
  };
}
