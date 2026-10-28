/**
 * The map's continuous colour scale, as on the 2025 Autumn Budget
 * dashboard (PolicyEngine/uk-autumn-budget-dashboard,
 * src/components/ConstituencyMap.jsx, lines 13-16 and 213-232, and
 * ConstituencyMap.css lines 177-182): amber #D97706 for a loss, through
 * light grey #E5E7EB at no change, to teal #14B8A6 for a gain, each half
 * interpolated in RGB, symmetric round 0 (always the neutral grey) and
 * clamping at its ends. The domain fits the figures shown (Vahid, 28
 * October: the stacked effects are a few hundredths of a per cent, so a
 * fixed ±1% left every seat grey): ± the 95th percentile of the drawn
 * seats' |value| for the selection, year and outcome, rounded up to a
 * clean 1-2-5 step (fittedExtent). SCALE_EXTENT is the fallback with no
 * figures.
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

/** The scale's fallback extent for an outcome, with no figures to fit. */
export const colourExtent = (outcome) => SCALE_EXTENT[outcome] ?? SCALE_EXTENT.relative_change;

// The smallest step each outcome's scale is rounded to: 0.01% of income, £1
const SMALLEST_STEP = Object.freeze({ relative_change: 0.0001, average_change: 1 });

/** The first clean 1-2-5 step (0.01%, 0.02%, 0.05%, 0.1%, …; £1, £2, £5, …) at or above `x`. */
export function cleanStepAbove(x, outcome) {
  const floor = SMALLEST_STEP[outcome] ?? SMALLEST_STEP.relative_change;
  if (!(x > floor)) return floor;
  let power = Math.floor(Math.log10(x));
  for (;;) {
    for (const m of [1, 2, 5]) {
      // toPrecision drops float artefacts (5 × 10^-4 is 0.0005, not 0.00050000001)
      const step = Number((m * 10 ** power).toPrecision(1));
      if (step >= x * (1 - 1e-12)) return step;
    }
    power += 1;
  }
}

/**
 * The colour domain's half-width for the figures drawn: the 95th
 * percentile of their sizes, rounded up to a clean step; the fallback
 * extent when there are none, or all are zero.
 *
 * @param {Iterable<number|string>} values - The drawn seats' figures.
 * @param {string} outcome
 */
export function fittedExtent(values, outcome) {
  const sizes = [...(values ?? [])].map((value) => Math.abs(Number(value))).filter(Number.isFinite).sort((a, b) => a - b);
  if (sizes.length === 0 || sizes[sizes.length - 1] === 0) return colourExtent(outcome);
  // Nearest rank: the size 95% of the drawn figures are at or below
  const p95 = sizes[Math.min(sizes.length - 1, Math.ceil(0.95 * sizes.length) - 1)];
  return cleanStepAbove(p95, outcome);
}

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
