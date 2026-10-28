/**
 * Constituencies on the map: each seat's state for one reform, year and
 * outcome, how it is drawn, and what the page says about it.
 *
 * A seat's state comes only from its own published row:
 *
 * - `reported` or `approximate`: the row's colour, solid when reported and
 *   plain either way (the card says when it is approximate);
 * - `withheld`: drawn as No data, with no figure;
 * - `no-data`: no row at all, drawn as such and never given a value.
 *
 * A seat too uncertain to place on the scale is drawn as No data too, so
 * the key is the colour scale and one No data swatch (Vahid, 28 October);
 * its card still gives its figure and interval.
 */

import { TOO_UNCERTAIN, classifyRow } from "./classify";
import { absDecimal, compareDecimal } from "./decimal";
import { formatFigure, formatInterval } from "./format";
import {
  CATEGORY_COLOURS,
  NO_DATA_FILL,
  NO_DATA_STROKE,
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

const OUTCOME_UNIT = { average_change: " a year", relative_change: " of income" };
const seatsWord = (n) => `${n.toLocaleString("en-GB")} constituenc${n === 1 ? "y" : "ies"}`;

// "Little change" is said only when it covers this share of the map's
// seats or more (Vahid, 28 October: "577 lose; 71 have no data")
const LITTLE_CHANGE_SHARE = 0.1;

/**
 * The card's one plain sentence under its title (Vahid, 27 October: "add a
 * subtitle like other boxes"), from the published rows the map colours, in
 * the outcome it shows: where households gain or lose on average, and the
 * range when every seat with a figure moves one way. Seats the map draws as
 * No data (not published, no row, too uncertain) are counted as "no data",
 * as the key names them, never explained (the key says why) and never
 * counted as a gain or loss. Little change is said only when it covers a
 * tenth of the seats or more. Null with no rows.
 *
 * @param {Map<string, {kind: string, row: Object|null}>|null} states - seatStates
 * @param {{outcome: string, yearLabel: string, several?: boolean}} options
 */
export function constituencySentence(states, { outcome, yearLabel, several = false }) {
  const all = [...(states?.values() ?? [])];
  if (!all.some((state) => state?.row)) return null;
  if (movesNoSeat(states)) {
    if (all.some((state) => state?.row?.tier === "withheld")) return noSeatMovedNote({ yearLabel, several });
    return `${several ? "These policies do" : "This policy does"} not change household incomes in any constituency in ${yearLabel}.`;
  }
  const placed = all.filter((state) => !drawnAsNoData(state)).map((state) => state.row);
  const noData = all.length - placed.length;
  // Signed as the seat cards colour them: a negligible figure is no change
  const gains = placed.filter((row) => signOf(row.value, outcome) === "gain");
  const losses = placed.filter((row) => signOf(row.value, outcome) === "loss");
  const flat = placed.length - gains.length - losses.length;
  // "; 71 have no data": the noun is said once, on the first count
  const noDataPart = noData > 0 ? `; ${noData.toLocaleString("en-GB")} ${noData === 1 ? "has" : "have"} no data` : "";
  const oneWay = flat === 0 && (gains.length === 0 || losses.length === 0);
  if (oneWay) {
    const moving = gains.length > 0 ? gains : losses;
    const sorted = [...moving].sort((a, b) => compareDecimal(absDecimal(a.value), absDecimal(b.value)));
    const [least, most] = [sorted[0], sorted[sorted.length - 1]];
    const size = (row) => formatFigure(outcome, row.value.replace(/^-/, ""), { signed: false });
    const every = noData > 0 ? `all ${seatsWord(placed.length)} with data` : `all ${seatsWord(placed.length)}`;
    const range =
      moving.length > 1 && compareDecimal(least.value, most.value) !== 0
        ? `, from ${size(least)}${OUTCOME_UNIT[outcome]} in ${least.areaName} to ${size(most)} in ${most.areaName}`
        : `, by ${size(most)}${OUTCOME_UNIT[outcome]}`;
    return `Households ${gains.length > 0 ? "gain" : "lose"} on average in ${every}${range}.`;
  }
  const sayFlat = flat > 0 && (flat >= LITTLE_CHANGE_SHARE * all.length || (gains.length === 0 && losses.length === 0));
  const parts = [
    gains.length > 0 && ["gain", gains.length],
    losses.length > 0 && ["lose", losses.length],
    // "Little change", as the map's key (round 3); here under 50p either way
    sayFlat && ["see little change", flat],
  ].filter(Boolean);
  // "gain on average in 600 constituencies and lose in 40": "on average"
  // and the noun once, on the first count
  const said = parts.map(([verb, n], i) =>
    i === 0 ? `${verb} on average in ${seatsWord(n)}` : `${verb} in ${n.toLocaleString("en-GB")}`,
  );
  const joined = said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}` : said[0];
  return `Households ${joined}${noDataPart}.`;
}

const PLAIN_STROKE = Object.freeze({ stroke: CHART_COLOURS.surface, strokeWidth: 0.05 });

/**
 * Whether the map draws a seat as No data: no row, not published (the
 * disclosure guard: never a colour, which on a map reads as a value), or
 * too uncertain to place on the scale.
 */
export function drawnAsNoData(state) {
  return !state || state.kind === "no-data" || state.kind === "withheld" || state.category === TOO_UNCERTAIN;
}

// The same thin border as every other seat (PLAIN_STROKE's width)
const NO_DATA_STYLE = Object.freeze({
  fill: NO_DATA_FILL,
  fillOpacity: 1,
  stroke: NO_DATA_STROKE,
  strokeWidth: 0.05,
});

/**
 * How a seat is drawn. `fill` is a plain colour, with no texture; a seat
 * drawn as No data (drawnAsNoData) is blank and outlined. With `colourOf`
 * (a value to a #rrggbb colour, the map's continuous scale) a seat takes
 * its figure's colour, approximate or not. Without it, its category's
 * colour.
 */
export function seatStyle(state, colourOf) {
  if (drawnAsNoData(state)) return { ...NO_DATA_STYLE };
  const colour = () => (colourOf ? colourOf(state.row?.value) : null);
  switch (state.kind) {
    // Approximate: plain colour, as a reported figure (Vahid, 28
    // October); the card and About this chart say it is approximate
    case "reported":
    case "approximate":
      return { fill: colour() ?? CATEGORY_COLOURS[state.category], fillOpacity: 1, ...PLAIN_STROKE };
    default:
      return { ...NO_DATA_STYLE };
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
export const WITHHELD_SEAT_NOTE = "No data: not published, too few survey households";
/** The card's line for a seat drawn as No data for a figure too uncertain to place on the scale. */
export const UNCERTAIN_SEAT_NOTE = "No data on the map: too uncertain to place on the scale";
/** A By policy row for a measure withheld in this seat, and its tooltip. */
export const WITHHELD_MEASURE_NOTE = "Not published";
export const WITHHELD_MEASURE_TITLE =
  "Not published for this constituency, to protect survey respondents' confidentiality.";

/** The By policy heading: the package's parts, or the other selected measures. */
export const PACKAGE_PARTS_HEADING = "Of which";
export const OTHER_POLICIES_HEADING = "Other selected policies";

/** The line for measures with no change in the seat: "+1 with no change". */
export const unchangedLine = (count) => `+${count} with no change`;

/** The card's line for an approximate figure: the map draws it plain, so the card says so. */
export const APPROXIMATE_SEAT_NOTE = "Approximate: based on fewer than 30 survey households";

/**
 * The card's one muted line on how firm a figure is, or null when there is
 * nothing to add: an approximate figure says so, with its 90% interval (the
 * map draws it in plain colour, with no texture); a reported figure whose
 * interval includes zero gives the interval.
 */
export function disclosureNote(row) {
  if (!row || row.tier === "withheld") return null;
  const interval = `90% interval ${formatInterval(row.outcome, row.lo, row.hi)}`;
  if (row.tier === "approximate") return `${APPROXIMATE_SEAT_NOTE}; ${interval}`;
  if (row.direction === "too_close_to_call") return interval;
  return null;
}

/** A figure's sign, for its colour: "gain", "loss" or "zero". */
export function signOf(value, outcome = "average_change") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "zero";
  // Under half a pound (or 0.005 points of income) reads as no change
  const negligible = outcome === "relative_change" ? 0.00005 : 0.5;
  if (Math.abs(number) < negligible) return "zero";
  return number > 0 ? "gain" : "loss";
}

function figureOf(row) {
  if (!row || row.tier === "withheld") return null;
  return {
    text: formatFigure(row.outcome, row.value),
    direction: row.direction,
    sign: signOf(row.value, row.outcome),
  };
}

/**
 * Everything the card says about one seat: its name, the figure for what
 * the map shows (one measure, or the package) in £ and as a share of
 * income, labelled with what it is, the rest of the selection's own £
 * changes in the seat, and one muted line on how firm the figure is.
 *
 * When the map shows one measure, the headline is that measure and the
 * other selected measures follow under "Other selected policies"; when it
 * shows the package, the headline is the package and each selected
 * measure follows under "Of which". Measures with no change are counted,
 * not listed.
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
 * @param {string} [options.label] - What the map shows, under the
 *   headline (by default the shown measure's name).
 * @returns {{title: string, kind: string, label: string|null,
 *   average: Object|null, relative: Object|null, policiesHeading:
 *   string|null, byPolicy: Array, unchanged: Array<string>, note:
 *   string|null, region: string|null}}
 */
export function seatCard({ feature, state, table, regional, reform, year, outcome, measures = [], label = null }) {
  const title = seatName(feature, state?.row);
  const empty = {
    title,
    label: null,
    average: null,
    relative: null,
    policiesHeading: null,
    byPolicy: [],
    unchanged: [],
    note: null,
    region: null,
  };
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
  const shownMeasure = measures.find((measure) => measure.id === reform);
  // The map's own measure is the headline, so its row is not repeated
  const others = shownMeasure ? measures.filter((measure) => measure.id !== reform) : measures;
  const rows = others
    .map((measure) => ({ measure, row: rowOf(measure.id, "average_change") }))
    .filter(({ row }) => row)
    .map(({ measure, row }) =>
      row.tier === "withheld"
        ? {
            id: measure.id,
            name: measure.name,
            text: WITHHELD_MEASURE_NOTE,
            title: WITHHELD_MEASURE_TITLE,
            direction: null,
            sign: null,
            value: null,
          }
        : {
            id: measure.id,
            name: measure.name,
            text: formatFigure("average_change", row.value),
            direction: row.direction,
            sign: signOf(row.value),
            value: Number(row.value),
          },
    );
  const unchanged = rows.filter((row) => row.sign === "zero").map((row) => row.name);
  const byPolicy = rows
    .filter((row) => row.sign !== "zero")
    // Largest first, by size; not published last
    .sort((a, b) => {
      if (a.value === null || b.value === null) return (a.value === null) - (b.value === null);
      return Math.abs(b.value) - Math.abs(a.value);
    });
  // The package's parts are worth listing only when there are two or more
  const listed = shownMeasure ? rows.length >= 1 : rows.length >= 2;
  return {
    ...empty,
    kind: state.kind,
    label: label ?? shownMeasure?.name ?? null,
    average: figureOf(averageRow),
    relative: figureOf(relativeRow),
    policiesHeading: listed ? (shownMeasure ? OTHER_POLICIES_HEADING : PACKAGE_PARTS_HEADING) : null,
    byPolicy: listed ? byPolicy : [],
    unchanged: listed ? unchanged : [],
    note:
      state.category === TOO_UNCERTAIN
        ? `${UNCERTAIN_SEAT_NOTE}; ${
            disclosureNote(state.row) ?? `90% interval ${formatInterval(state.row.outcome, state.row.lo, state.row.hi)}`
          }`
        : disclosureNote(state.row),
  };
}

/** The headline as one line: "−£150 · −0.21% of income". */
export function headlineText(card) {
  const parts = [];
  if (card.average) parts.push(card.average.text);
  if (card.relative) parts.push(`${card.relative.text} of income`);
  return parts.join(" · ");
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
  if (card.average || card.relative) {
    const lead = card.average ?? card.relative;
    lines.push({ kind: "value", text: headlineText(card), direction: lead.sign });
    lines.push({ kind: "label", text: card.label ?? "Average household impact" });
  }
  if (card.policiesHeading) {
    lines.push({ kind: "detail", text: card.policiesHeading });
    card.byPolicy.forEach((row) => lines.push({ kind: "detail", text: `${row.name}: ${row.text}` }));
    if (card.unchanged.length) lines.push({ kind: "detail", text: unchangedLine(card.unchanged.length) });
  }
  if (card.note) lines.push({ kind: "note", text: card.note });
  if (card.region) lines.push({ kind: "region", text: card.region });
  return { title: card.title, lines };
}

/** The card for one seat as a title and lines (see seatCard, cardLines). */
export const describeSeat = (options) => cardLines(seatCard(options));
