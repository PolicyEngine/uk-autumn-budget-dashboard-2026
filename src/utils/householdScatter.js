/**
 * The household scatter, as published in public/data/household_scatter_binned.csv.
 *
 * Households are never shown one by one: each row is one cell of baseline
 * income band by income change band, with the weighted number of
 * households in it (`uk-budget-data generate --only household_scatter`).
 * Cells with fewer than the floor of survey households are left out, and
 * counts are rounded, so the cells need not cover every household.
 *
 * Cells are published per reform and never added up by the page: one
 * measure shows its own cells, every measure shows the package's, and any
 * other selection shows a notice (as the constituency map does).
 */

import { fiscalYearLabel } from "./publication/format";
import { buildChartCsv } from "./chartCsv";
import { chooseReform } from "./geography/selection";
import {
  bandLabel,
  CHANGE_MAX,
  CHANGE_MIN,
  changeBandLabel as describeChangeBand,
  changeBandMiddle,
  openEdge,
  SCATTER_BINS,
  toChangeAxis,
  fromChangeAxis,
} from "./publication/scatter";

export const SCATTER_FILE = "household_scatter_binned.csv";

const COLUMNS = [
  "reform_id",
  "reform_name",
  "year",
  "income_band",
  "change_band",
  "change_band_upper",
  "households",
];
const NUMERIC = new Set([
  "year",
  "income_band",
  "change_band",
  "change_band_upper",
  "households",
]);

function splitCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Parse the published file. Throws if its columns are not the contract's
 * or a number does not parse, so a malformed file shows nothing.
 *
 * @param {string} text
 * @returns {Array<{reform_id: string, reform_name: string, year: number,
 *   income_band: number, change_band: number, change_band_upper: number,
 *   households: number}>}
 */
export function parseScatterCsv(text) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const header = splitCsvLine(lines[0] ?? "");
  if (header.join(",") !== COLUMNS.join(",")) {
    throw new Error(`${SCATTER_FILE}: unexpected columns`);
  }
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    COLUMNS.forEach((column, i) => {
      const value = values[i] ?? "";
      if (NUMERIC.has(column)) {
        const number = Number(value);
        if (value === "" || !Number.isFinite(number)) {
          throw new Error(`${SCATTER_FILE}: ${column} is not a number`);
        }
        row[column] = number;
      } else {
        row[column] = value;
      }
    });
    return row;
  });
}

const notice = (reason, detail = null) => ({ kind: "notice", reason, detail });

/**
 * What the scatter can show for a selection.
 *
 * @param {Object} options
 * @param {{status: "loading"|"ready"|"unavailable"|"error",
 *   rows: Array<Object>|null}} options.data
 * @param {Array<string>} options.selectedIds
 * @param {Array<string>} options.policyIds - Every measure the page offers.
 * @param {number} options.year
 * @returns {{kind: "loading"} | {kind: "notice", reason: string,
 *   detail: string|null} | {kind: "points", reform: string,
 *   points: Array<Object>}}
 */
export function scatterView({ data, selectedIds, policyIds, year }) {
  if (data.status === "loading") return { kind: "loading" };
  if (data.status !== "ready") {
    return notice("Household results are not yet published.");
  }
  const reforms = [...new Set(data.rows.map((row) => row.reform_id))];
  const choice = chooseReform({ selectedIds, policyIds, reforms });
  if (choice.kind === "none") {
    return notice("Select a measure to see household results.");
  }
  if (choice.kind === "pick") {
    return notice(
      "Household results are shown for one measure at a time, or for all measures together.",
      "Select one measure, or all of them. Groups of households are published for each measure separately and are not added together.",
    );
  }
  if (choice.kind === "no-package") {
    return notice("Household results are not yet published for the full package.");
  }
  if (!reforms.includes(choice.reform)) {
    return notice("Household results are not yet published for this measure.");
  }
  const bins = SCATTER_BINS;
  const points = data.rows
    // A cell whose count rounds to nothing has no bubble to draw.
    .filter(
      (row) =>
        row.reform_id === choice.reform && row.year === year && row.households > 0,
    )
    .map((row) => ({
      income: row.income_band + bins.income_band_width / 2,
      change: changeBandMiddle(row.change_band, row.change_band_upper),
      households: row.households,
      incomeBand: row.income_band,
      changeBand: row.change_band,
      changeBandUpper: row.change_band_upper,
    }));
  if (points.length === 0) {
    return notice(
      `No household results are published for this measure in ${fiscalYearLabel(year)}.`,
    );
  }
  return { kind: "points", reform: choice.reform, points };
}

const wholePounds = (value) =>
  `£${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value)}`;
const signedPounds = (value) =>
  `${value < 0 ? "−" : ""}${wholePounds(Math.abs(value))}`;

/** A cell's baseline income band, as words (outer bands open-ended). */
export const incomeBandLabel = (lower) =>
  bandLabel(
    lower,
    SCATTER_BINS.income_band_width,
    SCATTER_BINS.income_min,
    SCATTER_BINS.income_max,
    wholePounds,
  );

/**
 * A cell's income change band, as words: "No change", "£100 to £150",
 * "−£150 to −£100", "£5,000 or more" (outer bands open-ended).
 */
export const changeBandLabel = (lower, upper) =>
  describeChangeBand(lower, upper, signedPounds);

/** The cells a chart shows, as a CSV download. */
export function scatterCsv(points, { title }) {
  return buildChartCsv({
    title,
    units:
      "£ a year (bands of baseline household net income and of its change); households (weighted, rounded to the nearest 1,000)",
    columns: [
      { key: "income", label: "Baseline income band" },
      { key: "change", label: "Change band" },
      { key: "changeLower", label: "Change band lower edge", decimals: 0 },
      { key: "changeUpper", label: "Change band upper edge", decimals: 0 },
      { key: "households", label: "Households", decimals: 0 },
    ],
    rows: [...points]
      .sort(
        (a, b) =>
          a.incomeBand - b.incomeBand ||
          a.changeBand - b.changeBand ||
          a.changeBandUpper - b.changeBandUpper,
      )
      .map((point) => ({
        income: incomeBandLabel(point.incomeBand),
        change: changeBandLabel(point.changeBand, point.changeBandUpper),
        changeLower: point.changeBand,
        changeUpper: point.changeBandUpper,
        households: point.households,
      })),
    notes: [
      `Groups with fewer than ${SCATTER_BINS.min_households} surveyed households are not shown; the outer bands include everything beyond them.`,
      "Gains fall in [lower, upper) and losses in (lower, upper]; the no-change band is (−£1, £1); a band whose two edges are equal is open beyond that edge.",
    ],
  });
}

/** Households each dot of the scatter stands for. */
export const HOUSEHOLDS_PER_DOT = 20000;

/**
 * Where the open-ended outer change bands are drawn: a strip beyond the
 * plotted range at each end, this wide on the symlog change axis, marked
 * as "≥ £5,000", so the clamped cells never read as households at exactly
 * that change.
 */
export const EDGE_STRIP = 0.4;

/** The change axis's ends, on the symlog axis, strips included. */
export const CHANGE_AXIS_DOMAIN = [
  toChangeAxis(CHANGE_MIN) - EDGE_STRIP,
  toChangeAxis(CHANGE_MAX) + EDGE_STRIP,
];

/** Whether a cell is an open-ended outer change band ("lower" or "upper"). */
export function edgeOf(changeBand, changeBandUpper) {
  return openEdge(changeBand, changeBandUpper);
}

// A small seeded generator (mulberry32), so the dots sit in the same
// places on every render and in every download.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The cells as a dot cloud: each cell becomes about one dot per
 * `perDot` households (at least one), placed at random, deterministically,
 * inside the cell's own rectangle on the symlog change axis, so the cloud
 * reads as density. A dot is never a household: it carries its cell's
 * bands and count, and its place within the cell is arbitrary.
 *
 * The no-change band, (−£1, £1), is drawn as a line at £0. The outer change
 * bands, which hold every change beyond ±£5,000, are drawn in a strip of
 * `EDGE_STRIP` beyond the plotted range instead, and marked `edge`.
 *
 * @param {Array<{incomeBand: number, changeBand: number,
 *   changeBandUpper: number, households: number}>} cells
 * @returns {Array<Object>} dots with `income`, `y` (on the symlog change
 *   axis), `change` (the same place in £), `edge` and the cell's fields
 */
export function scatterDots(cells, { perDot = HOUSEHOLDS_PER_DOT, bins = SCATTER_BINS } = {}) {
  const inset = 0.08;
  const dots = [];
  for (const cell of cells) {
    const count = Math.max(1, Math.round(cell.households / perDot));
    const random = seeded(
      hash(`${cell.incomeBand}:${cell.changeBand}:${cell.changeBandUpper}`),
    );
    const edge = edgeOf(cell.changeBand, cell.changeBandUpper);
    const zero = cell.changeBand < 0 && cell.changeBandUpper > 0;
    let low;
    let high;
    if (edge === "upper") {
      low = toChangeAxis(cell.changeBand);
      high = low + EDGE_STRIP;
    } else if (edge === "lower") {
      high = toChangeAxis(cell.changeBand);
      low = high - EDGE_STRIP;
    } else if (zero) {
      low = 0;
      high = 0;
    } else {
      low = toChangeAxis(cell.changeBand);
      high = toChangeAxis(cell.changeBandUpper);
    }
    const incomeLow = cell.incomeBand;
    const incomeWidth = bins.income_band_width;
    for (let i = 0; i < count; i += 1) {
      const u = inset + (1 - 2 * inset) * random();
      const v = inset + (1 - 2 * inset) * random();
      const y = low + v * (high - low);
      dots.push({
        ...cell,
        income: incomeLow + u * incomeWidth,
        y,
        change: fromChangeAxis(y),
        edge,
        key: `${cell.incomeBand}:${cell.changeBand}:${cell.changeBandUpper}:${i}`,
      });
    }
  }
  return dots;
}
