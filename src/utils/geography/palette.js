/**
 * Colours and textures for results by area.
 *
 * Colour shows only the size of the change. Gains are teal and losses
 * amber, as across the dashboard, each with a lighter step for a small
 * change and a darker one for a large change. Little change is a mid grey;
 * too uncertain to classify is a light grey.
 *
 * Status is shown by texture, never by colour, so the two cannot be read
 * for each other: a reported figure is solid, an approximate one keeps its
 * category's colour under a dot texture, and a withheld area is hatched
 * with no colour at all, because on a map a colour reads as a value.
 */

import { TOO_UNCERTAIN } from "./classify";

export const CATEGORY_COLOURS = Object.freeze({
  large_loss: "#D97706",
  small_loss: "#FBBF24",
  little_change: "#9CA3AF",
  small_gain: "#81E6D9",
  large_gain: "#319795",
  [TOO_UNCERTAIN]: "#E5E7EB",
});

/** Text colours with enough contrast on white for each direction. */
export const DIRECTION_TEXT_COLOURS = Object.freeze({
  gain: "#0F766E",
  loss: "#B45309",
  too_close_to_call: "#4B5563",
  no_change: "#4B5563",
});

/**
 * The dot texture over an approximate figure's colour. There is one pattern
 * per category, each with the category's colour behind the dots, so a seat
 * keeps a single fill. Ids have no digits or colons, so url() resolves
 * anywhere, the exported file included.
 */
export const APPROXIMATE_DOT_COLOUR = "#1F2937";
export const approximatePatternId = (category) =>
  `approximate-dots-${category.replaceAll("_", "-")}`;
export const approximateFill = (category) =>
  `url(#${approximatePatternId(category)})`;

/** The hatch pattern's id: no digits or colons, so url() resolves anywhere. */
export const WITHHELD_PATTERN_ID = "withheld-hatch";
export const WITHHELD_FILL = `url(#${WITHHELD_PATTERN_ID})`;
export const HATCH_COLOURS = Object.freeze({
  background: "#FFFFFF",
  line: "#6B7280",
});

/** An area with no published row: white, outlined. */
export const NO_DATA_FILL = "#FFFFFF";
export const NO_DATA_STROKE = "#9CA3AF";
