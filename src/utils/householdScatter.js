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
  changeBandLabel as describeChangeBand,
  changeBandMiddle,
  openEdge,
  SCATTER_BINS,
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

/**
 * Dots in the cloud: the 2025 dashboard drew 500 households, sampled at
 * random with probability in proportion to their weight, so each dot stood
 * for about the same number of households. The cloud keeps that density.
 */
export const SCATTER_DOTS = 500;

/** The change axis, as in 2025: fixed at ±£5,000, linear. */
export const CHANGE_AXIS_DOMAIN = [-5000, 5000];

/** The income axis, as in 2025: £0 to £150,000. */
export const INCOME_AXIS_DOMAIN = [0, 150000];

/** Whether a cell is an open-ended outer change band ("lower" or "upper"). */
export function edgeOf(changeBand, changeBandUpper) {
  return openEdge(changeBand, changeBandUpper);
}

/** Households each dot stands for: every cell's households over the dots. */
export function householdsPerDot(cells, total = SCATTER_DOTS) {
  const households = cells.reduce((sum, cell) => sum + cell.households, 0);
  return households / total;
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

const cellKey = (cell) => `${cell.incomeBand}:${cell.changeBand}:${cell.changeBandUpper}`;

/**
 * How many of `total` dots each cell gets: in proportion to its households
 * (largest remainder), as a weighted sample of `total` households would
 * give on average. The dots add up to `total` exactly; a cell too small for
 * half a dot may get none, as it would mostly be missed by such a sample.
 */
export function allocateDots(cells, total = SCATTER_DOTS) {
  const households = cells.reduce((sum, cell) => sum + cell.households, 0);
  if (!(households > 0)) return cells.map(() => 0);
  const quotas = cells.map((cell) => (cell.households / households) * total);
  const counts = quotas.map(Math.floor);
  let left = total - counts.reduce((sum, n) => sum + n, 0);
  const order = cells
    .map((cell, i) => ({ i, rest: quotas[i] - counts[i], key: cellKey(cell) }))
    .sort((a, b) => b.rest - a.rest || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { i } of order) {
    if (left <= 0) break;
    counts[i] += 1;
    left -= 1;
  }
  return counts;
}

/**
 * The cells as a cloud of about `total` dots, drawn as the 2025 scatter of
 * sampled households was: income on one axis and change on the other, both
 * in £ and linear. Each cell gets its share of the dots (allocateDots),
 * placed at random, deterministically, inside the cell's own extent: its
 * £5,000 income band and its change band. A dot is never a household: it
 * carries its cell's bands and count, and its place within the cell is
 * arbitrary.
 *
 * The open-ended outer change bands (beyond ±£5,000) count towards the
 * dots, so the density matches, but are not drawn: as in 2025, changes
 * beyond the axis leave the plot.
 *
 * @param {Array<{incomeBand: number, changeBand: number,
 *   changeBandUpper: number, households: number}>} cells
 * @returns {Array<Object>} dots with `income`, `change` (£) and the
 *   cell's fields
 */
export function scatterDots(cells, { total = SCATTER_DOTS, bins = SCATTER_BINS } = {}) {
  const counts = allocateDots(cells, total);
  const dots = [];
  cells.forEach((cell, index) => {
    if (edgeOf(cell.changeBand, cell.changeBandUpper)) return;
    const random = seeded(hash(cellKey(cell)));
    const incomeLow = cell.incomeBand;
    const incomeWidth = Math.min(
      bins.income_band_width,
      bins.income_max - cell.incomeBand,
    );
    const low = cell.changeBand;
    const high = cell.changeBandUpper;
    for (let i = 0; i < counts[index]; i += 1) {
      const u = random();
      const v = random();
      dots.push({
        ...cell,
        income: incomeLow + u * incomeWidth,
        change: low + v * (high - low),
        key: `${cellKey(cell)}:${i}`,
      });
    }
  });
  return dots;
}
