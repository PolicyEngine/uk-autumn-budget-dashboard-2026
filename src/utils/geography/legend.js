/**
 * The map's status textures and legend, drawn into the map's own SVG.
 *
 * Both live in the SVG rather than the page around it, so an exported map
 * keeps them. Every colour, size and font is an attribute, not a style
 * from a stylesheet, so the exported file renders on its own.
 */

import { CATEGORIES, CATEGORY_LABELS, TOO_UNCERTAIN } from "./classify";
import { OUTCOME_LABELS } from "./format";
import {
  APPROXIMATE_DOT_COLOUR,
  CATEGORY_COLOURS,
  HATCH_COLOURS,
  NO_DATA_FILL,
  NO_DATA_STROKE,
  WITHHELD_FILL,
  WITHHELD_PATTERN_ID,
  UNCERTAIN_FILL,
  approximateColourPatternId,
  approximatePatternId,
} from "./palette";
import { SCALE_COLOURS, scaleLabels } from "./scale";
import { CHART_COLOURS } from "../chartTheme";

const FONT = "system-ui, -apple-system, sans-serif";
const HATCH_SIZE = 5;
const HATCH_STROKE_WIDTH = 1;
const DOT_SIZE = 4;

/** The legend's class, so exports and tests can find it. */
export const MAP_LEGEND_CLASS = "map-legend";

/** The legend's distance from the map's top-left corner, in SVG units. */
export const LEGEND_INSET = 12;

// Space between the legend's edge and its contents.
const PADDING = 10;

/**
 * A line's length in SVG units. The browser measures it; where it cannot
 * (the map is hidden, or there is no layout, as in tests), a generous
 * estimate from the character count stands in, so the line still fits.
 */
function lineLength(node, content, size) {
  const measured =
    typeof node.getComputedTextLength === "function"
      ? node.getComputedTextLength()
      : 0;
  return measured > 0 ? measured : content.length * size * 0.6;
}

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
    .attr("stroke-width", HATCH_STROKE_WIDTH);
  return pattern;
}

function appendDots(defs, id, colour) {
  const pattern = defs
    .append("pattern")
    .attr("id", id)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", DOT_SIZE)
    .attr("height", DOT_SIZE);
  pattern
    .append("rect")
    .attr("width", DOT_SIZE)
    .attr("height", DOT_SIZE)
    .attr("fill", colour);
  pattern
    .append("circle")
    .attr("cx", DOT_SIZE / 2)
    .attr("cy", DOT_SIZE / 2)
    .attr("r", 0.8)
    .attr("fill", APPROXIMATE_DOT_COLOUR)
    .attr("fill-opacity", 0.7);
  return pattern;
}

/**
 * Add the dot texture for approximate figures, one pattern per category
 * with that category's colour behind the dots, to `defs` (a d3 selection).
 */
export function appendApproximateDots(defs) {
  for (const category of [...CATEGORIES, TOO_UNCERTAIN]) {
    appendDots(defs, approximatePatternId(category), CATEGORY_COLOURS[category]);
  }
  return defs;
}

/**
 * Make sure `defs` (a d3 selection) has the dot texture over one colour of
 * the continuous scale, adding it the first time it is needed.
 */
export function ensureApproximateColourDots(defs, colour) {
  const id = approximateColourPatternId(colour);
  if (defs.select(`#${id}`).empty()) appendDots(defs, id, colour);
  return id;
}

/** Every texture the map uses: the withheld hatch and the dots. */
export function appendStatusPatterns(defs) {
  appendWithheldHatch(defs);
  appendApproximateDots(defs);
  return defs;
}

// The legend's gradient bar, in SVG units, and its gradient's id (no
// digits, so url() resolves anywhere).
const BAR_WIDTH = 180;
const BAR_HEIGHT = 10;
const GRADIENT_ID = "map-legend-gradient";

/**
 * The legend's status entries, after the scale: too uncertain, then the
 * textures, each over a gain and a loss colour, so they cannot be read as
 * a size of change.
 */
export function legendEntries() {
  return [
    { fill: CATEGORY_COLOURS.little_change, stroke: NO_DATA_STROKE, label: CATEGORY_LABELS.little_change },
    { fill: UNCERTAIN_FILL, label: CATEGORY_LABELS[TOO_UNCERTAIN] },
    {
      halves: [`url(#${approximatePatternId("large_gain")})`, `url(#${approximatePatternId("large_loss")})`],
      label: "Approximate: dotted, few survey households",
    },
    { fill: WITHHELD_FILL, label: "Not published: hatched, confidentiality" },
    { fill: NO_DATA_FILL, stroke: NO_DATA_STROKE, label: "No data: blank" },
  ];
}

function text(group, content, { x, y, size, weight = 400, fill = CHART_COLOURS.text }) {
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

/** Put the legend's top-left corner at (x, y), in the map's SVG units. */
export function placeMapLegend(group, { x = LEGEND_INSET, y = LEGEND_INSET } = {}) {
  return group.attr("transform", `translate(${x}, ${y})`);
}

/**
 * Draw the legend into `group` (a d3 selection of a <g>), replacing what
 * was there. The box is as wide as its longest line; placeMapLegend puts
 * it on the map.
 */
export function drawMapLegend(group, { outcome, extent }) {
  group.selectAll("*").remove();
  group.attr("class", MAP_LEGEND_CLASS);
  const entries = legendEntries();
  const background = group
    .append("rect")
    .attr("rx", 6)
    .attr("fill", CHART_COLOURS.surface)
    .attr("fill-opacity", 0.92)
    .attr("stroke", CHART_COLOURS.grid);
  const left = PADDING;
  let right = left + BAR_WIDTH;
  const write = (content, options) => {
    const node = text(group, content, options);
    right = Math.max(
      right,
      options.x + lineLength(node.node(), content, options.size),
    );
    return node;
  };
  let top = 18;
  write("Change in household net income", {
    x: left,
    y: top,
    size: 12,
    weight: 600,
  });
  top += 14;
  write(`Size of the change, in ${OUTCOME_LABELS[outcome]}`, {
    x: left,
    y: top,
    size: 10,
    fill: CHART_COLOURS.axisTitle,
  });
  // The scale: a gradient from loss to gain, labelled at its ends and 0
  top += 10;
  const gradient = group
    .append("defs")
    .append("linearGradient")
    .attr("id", GRADIENT_ID)
    .attr("x1", "0%")
    .attr("x2", "100%");
  [
    ["0%", SCALE_COLOURS.loss],
    ["50%", SCALE_COLOURS.neutral],
    ["100%", SCALE_COLOURS.gain],
  ].forEach(([offset, colour]) =>
    gradient.append("stop").attr("offset", offset).attr("stop-color", colour),
  );
  group
    .append("rect")
    .attr("x", left)
    .attr("y", top)
    .attr("width", BAR_WIDTH)
    .attr("height", BAR_HEIGHT)
    .attr("rx", 2)
    .attr("fill", `url(#${GRADIENT_ID})`);
  top += BAR_HEIGHT + 12;
  if (extent > 0) {
    scaleLabels(outcome, extent).forEach((label, index) =>
      write(label, {
        x: left + (index * BAR_WIDTH) / 2,
        y: top,
        size: 10,
        fill: CHART_COLOURS.axisTitle,
      }).attr("text-anchor", ["start", "middle", "end"][index]),
    );
  }
  top += 6;
  entries.forEach((entry) => {
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
      .attr("stroke", entry.stroke ?? CHART_COLOURS.axis)
      .attr("stroke-width", 0.5);
    write(entry.label, { x: left + 18, y: top, size: 11 });
  });
  background
    .attr("width", Math.ceil(right + PADDING))
    .attr("height", top + PADDING);
  return group;
}
