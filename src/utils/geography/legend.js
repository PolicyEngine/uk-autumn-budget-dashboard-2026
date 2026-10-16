/**
 * The map's status textures and legend, drawn into the map's own SVG.
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
  APPROXIMATE_DOT_COLOUR,
  CATEGORY_COLOURS,
  HATCH_COLOURS,
  NO_DATA_FILL,
  NO_DATA_STROKE,
  WITHHELD_FILL,
  WITHHELD_PATTERN_ID,
  approximateFill,
  approximatePatternId,
} from "./palette";

const FONT = "system-ui, -apple-system, sans-serif";
const HATCH_SIZE = 4;
const DOT_SIZE = 4;

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

/**
 * Add the dot texture for approximate figures, one pattern per category
 * with that category's colour behind the dots, to `defs` (a d3 selection).
 */
export function appendApproximateDots(defs) {
  for (const category of [...CATEGORIES, TOO_UNCERTAIN]) {
    const pattern = defs
      .append("pattern")
      .attr("id", approximatePatternId(category))
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", DOT_SIZE)
      .attr("height", DOT_SIZE);
    pattern
      .append("rect")
      .attr("width", DOT_SIZE)
      .attr("height", DOT_SIZE)
      .attr("fill", CATEGORY_COLOURS[category]);
    pattern
      .append("circle")
      .attr("cx", DOT_SIZE / 2)
      .attr("cy", DOT_SIZE / 2)
      .attr("r", 0.8)
      .attr("fill", APPROXIMATE_DOT_COLOUR)
      .attr("fill-opacity", 0.7);
  }
  return defs;
}

/** Every texture the map uses: the withheld hatch and the dots. */
export function appendStatusPatterns(defs) {
  appendWithheldHatch(defs);
  appendApproximateDots(defs);
  return defs;
}

/**
 * The legend's entries for an outcome: categories, then statuses. Status
 * swatches show texture only, over both a gain and a loss colour, so they
 * cannot be read as a size of change.
 */
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
    {
      halves: [CATEGORY_COLOURS.large_gain, CATEGORY_COLOURS.large_loss],
      label: "Reported: solid",
    },
    {
      halves: [approximateFill("large_gain"), approximateFill("large_loss")],
      label: "Approximate: dotted, few survey households",
    },
    { fill: WITHHELD_FILL, label: "Not published: hatched, confidentiality" },
    { fill: NO_DATA_FILL, stroke: NO_DATA_STROKE, label: "No data: blank" },
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
    if (entry.halves) {
      entry.halves.forEach((fill, half) =>
        group
          .append("rect")
          .attr("x", left + half * 6)
          .attr("y", top - 10)
          .attr("width", 6)
          .attr("height", 12)
          .attr("fill", fill),
      );
    }
    group
      .append("rect")
      .attr("x", left)
      .attr("y", top - 10)
      .attr("width", 12)
      .attr("height", 12)
      .attr("fill", entry.halves ? "none" : entry.fill)
      .attr("stroke", entry.stroke ?? "#D1D5DB")
      .attr("stroke-width", 0.5);
    text(group, entry.label, { x: left + 18, y: top, size: 11 });
  };
  categories.forEach(row);
  top += 22;
  text(group, "Status, shown by texture", {
    x: left,
    y: top,
    size: 11,
    weight: 600,
  });
  top -= 2;
  tiers.forEach(row);
  background.attr("height", top + 10);
  return group;
}
