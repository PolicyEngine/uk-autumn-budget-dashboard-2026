/**
 * Constituencies on the map: each seat's state for one reform, year and
 * outcome, how it is drawn, and what the page says about it.
 *
 * A seat's state comes only from its own published row:
 *
 * - `reported` or `approximate`: the row's category colour, solid when
 *   reported and under a dot texture when approximate;
 * - `withheld`: hatched, with no figure;
 * - `no-data`: no row at all, drawn as such and never given a value.
 */

import { classifyRow } from "./classify";
import { formatFigure, formatInterval } from "./format";
import {
  CATEGORY_COLOURS,
  NO_DATA_FILL,
  NO_DATA_STROKE,
  WITHHELD_FILL,
  approximateFill,
} from "./palette";
import { regionForBoundary } from "./regions";
import { lookupRow } from "./rows";
import { CHART_COLOURS } from "../chartTheme";

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

/**
 * Whether no seat shows a published change: at least one seat has a row,
 * and every row is withheld or "no_change" (all zeros). Seats with no row
 * are left out, as the map draws them as no data.
 */
export function movesNoSeat(states) {
  let rows = 0;
  for (const state of states?.values() ?? []) {
    const row = state?.row;
    if (!row) continue;
    rows += 1;
    if (row.tier !== "withheld" && row.direction !== "no_change") return false;
  }
  return rows > 0;
}

/** The line under the map when no seat shows a published change. */
export const noSeatMovedNote = ({ yearLabel, several = false }) =>
  `No constituency shows a change large enough to publish for ${several ? "these policies" : "this policy"} in ${yearLabel}.`;

const PLAIN_STROKE = Object.freeze({ stroke: CHART_COLOURS.surface, strokeWidth: 0.05 });

/**
 * How a seat is drawn. `fill` is an attribute value: a colour, a dotted
 * pattern's url() for an approximate seat, or the hatch's for a withheld
 * one.
 */
export function seatStyle(state) {
  switch (state?.kind) {
    case "reported":
      return { fill: CATEGORY_COLOURS[state.category], fillOpacity: 1, ...PLAIN_STROKE };
    case "approximate":
      return {
        fill: approximateFill(state.category),
        fillOpacity: 1,
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

/** One line for a search result: the figure, or why there is none. */
export function seatSummary(state) {
  if (!state || state.kind === "no-data") return "No data";
  if (state.kind === "withheld") return "Not published";
  const summary = formatFigure(state.row.outcome, state.row.value);
  return state.kind === "approximate" ? `${summary} (approximate)` : summary;
}

/** The card's line for a seat with no published figure. */
export const WITHHELD_SEAT_NOTE = "Not published: too few survey households";
/** A By policy row for a measure withheld in this seat. */
export const WITHHELD_MEASURE_NOTE = "Not published for this seat";

const SUPPORT_BAND_WORDS = Object.freeze({
  "<10": "fewer than 10",
  "10–29": "10–29",
  "30+": "30 or more",
});

/**
 * The card's one muted line on how firm a figure is, or null when there is
 * nothing to add: an approximate figure gives its survey households and
 * 90% interval; a reported figure whose interval includes zero gives the
 * interval.
 */
export function disclosureNote(row) {
  if (!row || row.tier === "withheld") return null;
  const interval = `90% interval ${formatInterval(row.outcome, row.lo, row.hi)}`;
  if (row.tier === "approximate") {
    const band = SUPPORT_BAND_WORDS[row.supportBand];
    return band ? `Estimate from ${band} survey households; ${interval}` : `Approximate estimate; ${interval}`;
  }
  if (row.direction === "too_close_to_call") return interval;
  return null;
}

function figureOf(row) {
  if (!row || row.tier === "withheld") return null;
  return { text: formatFigure(row.outcome, row.value), direction: row.direction };
}

/**
 * Everything the card says about one seat: its name, the shown measure's
 * average change in £ and as a share of income, each selected measure's
 * own £ change in the seat (when two or more measures have constituency
 * results), and one muted line on how firm the figure is.
 *
 * Every figure is a published row; nothing is summed or derived.
 *
 * @param {Object} options
 * @param {Object} options.feature - The seat's boundary feature.
 * @param {Object} [options.state] - Its state, from seatStates.
 * @param {Object} [options.table] - The constituency table.
 * @param {Object} [options.regional] - The regional table.
 * @param {string} options.reform - The reform the map shows.
 * @param {number} options.year
 * @param {string} options.outcome - The outcome the map shows.
 * @param {Array<{id: string, name: string}>} [options.measures] - The
 *   selected measures, in the page's order, for the By policy rows.
 * @returns {{title: string, kind: string, average: Object|null,
 *   relative: Object|null, byPolicy: Array, note: string|null,
 *   region: string|null}}
 */
export function seatCard({ feature, state, table, regional, reform, year, outcome, measures = [] }) {
  const title = seatName(feature, state?.row);
  const empty = { title, average: null, relative: null, byPolicy: [], note: null, region: null };
  if (!state || state.kind === "no-data") {
    return { ...empty, kind: "no-data", note: `No data. ${NO_DATA_NOTE}` };
  }
  if (state.kind === "withheld") {
    let region = null;
    const area = regionForBoundary(feature?.properties);
    const regionRow = area
      ? lookupRow(regional, { areaCode: area.code, reform, year, outcome })
      : null;
    if (regionRow && regionRow.tier !== "withheld") {
      const approximate = regionRow.tier === "approximate" ? ", approximate" : "";
      region =
        `Regional figure for ${area.name}, not an estimate for this ` +
        `constituency: ${formatFigure(outcome, regionRow.value)} ` +
        `(${formatInterval(outcome, regionRow.lo, regionRow.hi)}${approximate})`;
    }
    return { ...empty, kind: "withheld", note: WITHHELD_SEAT_NOTE, region };
  }
  const areaCode = state.row.areaCode ?? seatCode(feature);
  const rowOf = (id, which) => lookupRow(table, { areaCode, reform: id, year, outcome: which });
  const averageRow = outcome === "average_change" ? state.row : rowOf(reform, "average_change");
  const relativeRow = outcome === "relative_change" ? state.row : rowOf(reform, "relative_change");
  const byPolicy = measures
    .map((measure) => ({ measure, row: rowOf(measure.id, "average_change") }))
    .filter(({ row }) => row)
    .map(({ measure, row }) =>
      row.tier === "withheld"
        ? { id: measure.id, name: measure.name, text: WITHHELD_MEASURE_NOTE, direction: null, value: null }
        : {
            id: measure.id,
            name: measure.name,
            text: formatFigure("average_change", row.value),
            direction: row.direction,
            value: Number(row.value),
          },
    )
    .sort((a, b) => {
      if (a.value === null || b.value === null) return (a.value === null) - (b.value === null);
      return b.value - a.value;
    });
  return {
    ...empty,
    kind: state.kind,
    average: figureOf(averageRow),
    relative: figureOf(relativeRow),
    // One measure's row would only repeat the headline
    byPolicy: byPolicy.length >= 2 ? byPolicy : [],
    note: disclosureNote(state.row),
  };
}

/**
 * The card as a title and lines of text, for the exported map's card, so
 * the file says what the page's card says.
 *
 * @returns {{title: string, lines: Array<{kind: string, text: string,
 *   direction?: string}>}}
 */
export function cardLines(card) {
  const lines = [];
  if (card.average) {
    lines.push({ kind: "value", text: card.average.text, direction: card.average.direction });
    lines.push({ kind: "label", text: "Average household impact" });
  }
  if (card.relative) {
    lines.push({ kind: "value", text: card.relative.text, direction: card.relative.direction });
    lines.push({ kind: "label", text: "Relative change" });
  }
  if (card.byPolicy.length) {
    lines.push({ kind: "detail", text: "By policy:" });
    card.byPolicy.forEach((row) => lines.push({ kind: "detail", text: `${row.name}: ${row.text}` }));
  }
  if (card.note) lines.push({ kind: "note", text: card.note });
  if (card.region) lines.push({ kind: "region", text: card.region });
  return { title: card.title, lines };
}

/** The card for one seat as a title and lines (see seatCard, cardLines). */
export const describeSeat = (options) => cardLines(seatCard(options));
