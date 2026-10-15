/**
 * Map categories for results by area.
 *
 * The breaks are fixed before any data is seen, and the same for every
 * reform and year, so a colour always means the same size of change. They
 * are never derived from the published figures.
 *
 * An area gets a category only when its 90% interval lies within one
 * category or two adjacent ones; it then takes its value's category.
 * Otherwise it is too uncertain to classify. A withheld area has none.
 */

import { absDecimal, compareDecimal, signOf } from "./decimal";
import { formatFigure } from "./format";

/**
 * The category breaks, as published-style strings in each outcome's units:
 * little change is below `small` either way, a small change is from `small`
 * up to `large`, and a large change is `large` or more.
 *
 * To confirm with Vahid.
 */
export const CATEGORY_BREAKS = Object.freeze({
  relative_change: Object.freeze({ small: "0.001", large: "0.01" }),
  average_change: Object.freeze({ small: "10", large: "100" }),
});

/** The categories, from the largest loss to the largest gain. */
export const CATEGORIES = Object.freeze([
  "large_loss",
  "small_loss",
  "little_change",
  "small_gain",
  "large_gain",
]);

export const TOO_UNCERTAIN = "too_uncertain";

export const CATEGORY_LABELS = Object.freeze({
  large_loss: "Large loss",
  small_loss: "Small loss",
  little_change: "Little change",
  small_gain: "Small gain",
  large_gain: "Large gain",
  [TOO_UNCERTAIN]: "Too uncertain to classify",
});

/** The position in CATEGORIES of one published figure. */
export function categoryIndex(outcome, text) {
  const breaks = CATEGORY_BREAKS[outcome];
  if (!breaks) throw new Error(`unknown outcome ${outcome}`);
  const magnitude = absDecimal(text);
  if (compareDecimal(magnitude, breaks.small) < 0) return 2;
  const large = compareDecimal(magnitude, breaks.large) >= 0;
  if (signOf(text) > 0) return large ? 4 : 3;
  return large ? 0 : 1;
}

/**
 * The category of a published row: one of CATEGORIES, TOO_UNCERTAIN, or
 * null for a withheld row.
 */
export function classifyRow(row) {
  if (!row || row.tier === "withheld") return null;
  const low = categoryIndex(row.outcome, row.lo);
  const high = categoryIndex(row.outcome, row.hi);
  if (high - low > 1) return TOO_UNCERTAIN;
  return CATEGORIES[categoryIndex(row.outcome, row.value)];
}

/**
 * What each category covers, in words, for legends: "0.1% to 1%",
 * "£100 or more", "under £10 either way".
 */
export function categoryRanges(outcome) {
  const { small, large } = CATEGORY_BREAKS[outcome];
  const show = (text) => formatFigure(outcome, text, { signed: false });
  const smallRange = `${show(small)} to ${show(large)}`;
  const largeRange = `${show(large)} or more`;
  return {
    large_loss: largeRange,
    small_loss: smallRange,
    little_change: `under ${show(small)} either way`,
    small_gain: smallRange,
    large_gain: largeRange,
  };
}
