/**
 * Colours and textures for results by area.
 *
 * Colour shows only the size of the change. Gains are teal and losses
 * amber, as across the dashboard, each with a lighter step for a small
 * change and a darker one for a large change. Little or no change is the
 * light grey of the continuous scale's £0; too uncertain to classify is a
 * mid grey, in both views (Pavel's review, MAP1: the two views had the two
 * greys the other way round).
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
  little_change: CHART_COLOURS.grid,
  small_gain: CHART_COLOURS.gainLight,
  large_gain: CHART_COLOURS.gain,
  [TOO_UNCERTAIN]: CHART_COLOURS.noChange,
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

/**
 * On the continuous scale, a seat too uncertain to classify is mid grey,
 * apart from the light grey of no change.
 */
export const UNCERTAIN_FILL = CHART_COLOURS.noChange;

/**
 * The dot texture over one colour of the continuous scale (#rrggbb). The
 * hex digits are spelt as letters (0 to g … 9 to p), so the id has no
 * digits and url() resolves anywhere.
 */
export const approximateColourPatternId = (colour) =>
  `approximate-dots-c${colour
    .replace("#", "")
    .toLowerCase()
    .replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)))}`;
export const approximateColourFill = (colour) =>
  `url(#${approximateColourPatternId(colour)})`;

/** The hatch pattern's id: no digits or colons, so url() resolves anywhere. */
export const WITHHELD_PATTERN_ID = "withheld-hatch";
export const WITHHELD_FILL = `url(#${WITHHELD_PATTERN_ID})`;
/**
 * Faded on purpose: thin light-grey lines (1.9:1 on white) on the faintest
 * grey, so the texture reads as "no figure" without drawing the eye.
 */
export const HATCH_COLOURS = Object.freeze({
  background: CHART_COLOURS.rowBand,
  line: CHART_COLOURS.hatchLine,
});

/**
 * An area with no data (no row, not published, or too uncertain to place
 * on the scale): a faint cool grey that does not draw the eye, lighter
 * than the scale's 0 (the light grey of no change) and so than every
 * colour on the scale, yet still apart from the white card, with the same
 * thin white border as every other area (Vahid, 28 October).
 */
export const NO_DATA_FILL = CHART_COLOURS.noData;
export const NO_DATA_STROKE = CHART_COLOURS.surface;
