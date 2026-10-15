/**
 * The map's hatch pattern and legend, drawn into the map's own SVG.
 *
 * Both live in the SVG rather than the page around it, so an exported map
 * keeps them. Every colour, size and font is an attribute, not a style
 * from a stylesheet, so the exported file renders on its own.
 */

import {
  CATEGORIES,
  CATEGORY_LABELS,
  TOO_UNCERTAIN,
  categoryRanges,
} from "./classify";
import { OUTCOME_LABELS } from "./format";
import {
  APPROXIMATE_OPACITY,
  CATEGORY_COLOURS,
  HATCH_COLOURS,
  NO_DATA_FILL,
  NO_DATA_STROKE,
  WITHHELD_FILL,
  WITHHELD_PATTERN_ID,
} from "./palette";

const FONT = "system-ui, -apple-system, sans-serif";
const HATCH_SIZE = 4;

/** The legend's class, so exports and tests can find it. */
export const MAP_LEGEND_CLASS = "map-legend";

/**
 * Add the withheld hatch, a vector pattern of diagonal lines, to `defs`
 * (a d3 selection).
 */
export function appendWithheldHatch(defs) {
  const pattern = defs
    .append("pattern")
    .attr("id", WITHHELD_PATTERN_ID)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", HATCH_SIZE)
    .attr("height", HATCH_SIZE)
    .attr("patternTransform", "rotate(45)");
  pattern
    .append("rect")
    .attr("width", HATCH_SIZE)
    .attr("height", HATCH_SIZE)
    .attr("fill", HATCH_COLOURS.background);
  pattern
    .append("line")
    .attr("x1", HATCH_SIZE / 2)
    .attr("y1", 0)
    .attr("x2", HATCH_SIZE / 2)
    .attr("y2", HATCH_SIZE)
    .attr("stroke", HATCH_COLOURS.line)
    .attr("stroke-width", 1.5);
  return pattern;
}

/** The legend's entries for an outcome: categories, then tiers. */
export function legendEntries(outcome) {
  const ranges = categoryRanges(outcome);
  const categories = [...CATEGORIES].reverse().map((category) => ({
    fill: CATEGORY_COLOURS[category],
    label: `${CATEGORY_LABELS[category]}: ${ranges[category]}`,
  }));
  categories.push({
    fill: CATEGORY_COLOURS[TOO_UNCERTAIN],
    label: CATEGORY_LABELS[TOO_UNCERTAIN],
  });
  const tiers = [
    { fill: CATEGORY_COLOURS.large_gain, label: "Reported" },
    {
      fill: CATEGORY_COLOURS.large_gain,
      opacity: APPROXIMATE_OPACITY,
      label: "Approximate: few survey households",
    },
    { fill: WITHHELD_FILL, label: "Not published: confidentiality" },
    { fill: NO_DATA_FILL, stroke: NO_DATA_STROKE, label: "No data" },
  ];
  return { categories, tiers };
}

function text(group, content, { x, y, size, weight = 400, fill = "#374151" }) {
  return group
    .append("text")
    .attr("x", x)
    .attr("y", y)
    .attr("font-family", FONT)
    .attr("font-size", size)
    .attr("font-weight", weight)
    .attr("fill", fill)
    .text(content);
}

/**
 * Draw the legend into `group` (a d3 selection of a <g>), replacing what
 * was there.
 */
export function drawMapLegend(group, { outcome, x = 12, y = 12, width = 238 }) {
  group.selectAll("*").remove();
  group.attr("class", MAP_LEGEND_CLASS).attr("transform", `translate(${x}, ${y})`);
  const { categories, tiers } = legendEntries(outcome);
  const background = group
    .append("rect")
    .attr("width", width)
    .attr("rx", 6)
    .attr("fill", "#FFFFFF")
    .attr("fill-opacity", 0.92)
    .attr("stroke", "#E5E7EB");
  const left = 10;
  let top = 18;
  text(group, "Change in household net income", {
    x: left,
    y: top,
    size: 12,
    weight: 600,
  });
  top += 14;
  text(group, `Size of the change, in ${OUTCOME_LABELS[outcome]}`, {
    x: left,
    y: top,
    size: 10,
    fill: "#4B5563",
  });
  top += 8;
  const row = (entry) => {
    top += 16;
    const swatch = group
      .append("rect")
      .attr("x", left)
      .attr("y", top - 10)
      .attr("width", 12)
      .attr("height", 12)
      .attr("fill", entry.fill)
      .attr("stroke", entry.stroke ?? "#D1D5DB")
      .attr("stroke-width", 0.5);
    if (entry.opacity !== undefined) swatch.attr("fill-opacity", entry.opacity);
    text(group, entry.label, { x: left + 18, y: top, size: 11 });
  };
  categories.forEach(row);
  top += 22;
  text(group, "Status", { x: left, y: top, size: 11, weight: 600 });
  top -= 2;
  tiers.forEach(row);
  background.attr("height", top + 10);
  return group;
}
