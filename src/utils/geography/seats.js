/**
 * Constituencies on the map: each seat's state for one reform, year and
 * outcome, how it is drawn, and what the page says about it.
 *
 * A seat's state comes only from its own published row:
 *
 * - `reported` or `approximate`: the row's category colour, lighter when
 *   approximate;
 * - `withheld`: hatched, with no figure;
 * - `no-data`: no row at all, drawn as such and never given a value.
 */

import {
  CATEGORY_LABELS,
  classifyRow,
} from "./classify";
import {
  DIRECTION_LABELS,
  SUPPORT_BAND_LABELS,
  TIER_DESCRIPTIONS,
  WITHHELD_NOTE,
  formatFigure,
  formatInterval,
} from "./format";
import {
  APPROXIMATE_OPACITY,
  CATEGORY_COLOURS,
  NO_DATA_FILL,
  NO_DATA_STROKE,
  WITHHELD_FILL,
} from "./palette";
import { regionForBoundary } from "./regions";
import { lookupRow } from "./rows";

export const NO_DATA_NOTE = "No figure is published for this constituency.";

/** The seat's ONS code, from the boundary file. */
export const seatCode = (feature) => feature?.properties?.GSScode ?? "";

/** The seat's name: as published, or from the boundary file. */
export const seatName = (feature, row) =>
  row?.areaName ?? feature?.properties?.Name ?? seatCode(feature);

function stateOf(row) {
  if (!row) return Object.freeze({ kind: "no-data", row: null, category: null });
  if (row.tier === "withheld") {
    return Object.freeze({ kind: "withheld", row, category: null });
  }
  return Object.freeze({ kind: row.tier, row, category: classifyRow(row) });
}

/**
 * Every seat's state, by code.
 *
 * @returns {Map<string, {kind: string, row: Object|null,
 *   category: string|null}>}
 */
export function seatStates(features, table, { reform, year, outcome }) {
  return new Map(
    features.map((feature) => {
      const code = seatCode(feature);
      return [code, stateOf(lookupRow(table, { areaCode: code, reform, year, outcome }))];
    }),
  );
}

const PLAIN_STROKE = Object.freeze({ stroke: "#FFFFFF", strokeWidth: 0.05 });

/**
 * How a seat is drawn. `fill` is an attribute value: a colour, or the
 * hatch pattern's url() for a withheld seat.
 */
export function seatStyle(state) {
  switch (state?.kind) {
    case "reported":
      return { fill: CATEGORY_COLOURS[state.category], fillOpacity: 1, ...PLAIN_STROKE };
    case "approximate":
      return {
        fill: CATEGORY_COLOURS[state.category],
        fillOpacity: APPROXIMATE_OPACITY,
        ...PLAIN_STROKE,
      };
    case "withheld":
      return { fill: WITHHELD_FILL, fillOpacity: 1, ...PLAIN_STROKE };
    default:
      return {
        fill: NO_DATA_FILL,
        fillOpacity: 1,
        stroke: NO_DATA_STROKE,
        strokeWidth: 0.3,
      };
  }
}

const OUTCOME_LINE_LABELS = Object.freeze({
  average_change: "Average change per household, per year",
  relative_change: "Average change, as a share of household income",
});

/** One line for a search result: the figure, or why there is none. */
export function seatSummary(state) {
  if (!state || state.kind === "no-data") return "No data";
  if (state.kind === "withheld") return "Not published";
  const summary = formatFigure(state.row.outcome, state.row.value);
  return state.kind === "approximate" ? `${summary} (approximate)` : summary;
}

/**
 * What the page says about one seat, as a title and lines of text. The
 * on-screen tooltip and the exported map's card both show these lines, so
 * the two never differ.
 *
 * A withheld seat says only that it is not published; when its region's
 * figure is published, that figure follows, labelled as the region's.
 *
 * @returns {{title: string, lines: Array<{kind: string, text: string,
 *   direction?: string, emphasis?: boolean}>}}
 */
export function describeSeat({ feature, state, regional, reform, year, outcome }) {
  const title = seatName(feature, state?.row);
  if (!state || state.kind === "no-data") {
    return { title, lines: [{ kind: "note", text: `No data. ${NO_DATA_NOTE}` }] };
  }
  if (state.kind === "withheld") {
    const lines = [{ kind: "note", text: WITHHELD_NOTE }];
    const region = regionForBoundary(feature?.properties);
    const regionRow = region
      ? lookupRow(regional, { areaCode: region.code, reform, year, outcome })
      : null;
    if (regionRow && regionRow.tier !== "withheld") {
      const approximate = regionRow.tier === "approximate" ? ", approximate" : "";
      lines.push({
        kind: "region",
        text:
          `Regional figure for ${region.name}, not an estimate for this ` +
          `constituency: ${formatFigure(outcome, regionRow.value)} ` +
          `(${formatInterval(outcome, regionRow.lo, regionRow.hi)}${approximate})`,
      });
    }
    return { title, lines };
  }
  const { row } = state;
  const approximate = state.kind === "approximate";
  return {
    title,
    lines: [
      { kind: "value", text: formatFigure(row.outcome, row.value), direction: row.direction },
      { kind: "label", text: OUTCOME_LINE_LABELS[row.outcome] },
      {
        kind: "interval",
        text: `90% interval: ${formatInterval(row.outcome, row.lo, row.hi)}`,
        emphasis: approximate,
      },
      { kind: "detail", text: DIRECTION_LABELS[row.direction] },
      { kind: "detail", text: approximate ? TIER_DESCRIPTIONS.approximate : "Reported" },
      { kind: "detail", text: SUPPORT_BAND_LABELS[row.supportBand] },
      { kind: "detail", text: `Map category: ${CATEGORY_LABELS[state.category]}` },
    ],
  };
}
