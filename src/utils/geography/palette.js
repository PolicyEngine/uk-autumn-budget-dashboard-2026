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
import { CHART_COLOURS } from "../chartTheme";

export const CATEGORY_COLOURS = Object.freeze({
  large_loss: CHART_COLOURS.loss,
  small_loss: CHART_COLOURS.lossLight,
  little_change: CHART_COLOURS.noChange,
  small_gain: CHART_COLOURS.gainLight,
  large_gain: CHART_COLOURS.gain,
  [TOO_UNCERTAIN]: CHART_COLOURS.grid,
});

/** Text colours with enough contrast on white for each direction. */
export const DIRECTION_TEXT_COLOURS = Object.freeze({
  gain: CHART_COLOURS.gainText,
  loss: CHART_COLOURS.lossText,
  too_close_to_call: CHART_COLOURS.axisTitle,
  no_change: CHART_COLOURS.axisTitle,
});

/**
 * The dot texture over an approximate figure's colour. There is one pattern
 * per category, each with the category's colour behind the dots, so a seat
 * keeps a single fill. Ids have no digits or colons, so url() resolves
 * anywhere, the exported file included.
 */
export const APPROXIMATE_DOT_COLOUR = CHART_COLOURS.ink;
export const approximatePatternId = (category) =>
  `approximate-dots-${category.replaceAll("_", "-")}`;
export const approximateFill = (category) =>
  `url(#${approximatePatternId(category)})`;

/** The hatch pattern's id: no digits or colons, so url() resolves anywhere. */
export const WITHHELD_PATTERN_ID = "withheld-hatch";
export const WITHHELD_FILL = `url(#${WITHHELD_PATTERN_ID})`;
export const HATCH_COLOURS = Object.freeze({
  background: CHART_COLOURS.surface,
  line: CHART_COLOURS.tick,
});

/** An area with no published row: white, outlined. */
export const NO_DATA_FILL = CHART_COLOURS.surface;
export const NO_DATA_STROKE = CHART_COLOURS.noChange;
