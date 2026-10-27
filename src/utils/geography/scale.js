/**
 * The map's continuous colour scale, as on the 2025 Autumn Budget
 * dashboard (PolicyEngine/uk-autumn-budget-dashboard,
 * src/components/ConstituencyMap.jsx, lines 13-16 and 213-232, and
 * ConstituencyMap.css lines 177-182): amber #D97706 for a loss, through
 * light grey #E5E7EB at no change, to teal #14B8A6 for a gain, each half
 * interpolated in RGB, on a fixed domain of −1% to +1% that clamps at its
 * ends and is the same for every measure and year. In £ a year the same
 * scale runs from −£100 to +£100.
 */

import * as d3 from "d3";
import { formatFigure } from "./format";
import { CHART_COLOURS } from "../chartTheme";

export const SCALE_COLOURS = Object.freeze({
  loss: CHART_COLOURS.loss,
  neutral: CHART_COLOURS.grid,
  gain: CHART_COLOURS.mapGain,
});

/** The fixed extent, in each outcome's units (a fraction, or £). */
export const SCALE_EXTENT = Object.freeze({
  relative_change: 0.01,
  average_change: 100,
});

// Steps the scale is drawn in: a hundred, too fine to see, and a bounded
// set of dot textures for the approximate seats.
const STEPS = 100;

/** The scale's extent for an outcome. */
export const colourExtent = (outcome) => SCALE_EXTENT[outcome] ?? SCALE_EXTENT.relative_change;

const lossHalf = d3.interpolateRgb(SCALE_COLOURS.loss, SCALE_COLOURS.neutral);
const gainHalf = d3.interpolateRgb(SCALE_COLOURS.neutral, SCALE_COLOURS.gain);

/** A value's colour, as #rrggbb, on a scale from −extent to +extent. */
export function scaleColour(value, extent) {
  const number = Number(value);
  if (!Number.isFinite(number) || !(extent > 0)) return SCALE_COLOURS.neutral;
  const t = Math.max(-1, Math.min(1, number / extent));
  const step = Math.round(Math.abs(t) * STEPS) / STEPS;
  if (step === 0) return SCALE_COLOURS.neutral;
  const colour = t < 0 ? lossHalf(1 - step) : gainHalf(step);
  return d3.color(colour).formatHex();
}

/** The scale's three labels: "−1%", "0%", "+1%" (or £). */
export function scaleLabels(outcome, extent) {
  const show = (number) => formatFigure(outcome, String(number), { signed: false });
  return [`−${show(extent)}`, show(0), `+${show(extent)}`];
}

/** The scale as a CSS gradient, left (loss) to right (gain). */
export const SCALE_GRADIENT = `linear-gradient(to right, ${SCALE_COLOURS.loss}, ${SCALE_COLOURS.neutral}, ${SCALE_COLOURS.gain})`;
