/**
 * The household scatter, from each verified artifact's household_scatter_binned.csv.
 *
 * Households are never shown one by one: each row is one cell of baseline
 * income band by income change band, with the weighted number of
 * households in it (`uk-budget-data generate --only household_scatter`).
 * Cells with fewer than the floor of survey households are left out, and
 * counts are rounded, so the cells need not cover every household.
 *
 * Cells are published per reform and never added up by the page: one
 * policy shows its own cells, several the published combined run of
 * exactly those policies, and with no such run the card says the
 * combination is not published yet (as the constituency map does). It
 * never shows one policy in place of a selection.
 *
 * Every year's households are banded by their baseline income in one year,
 * the basis year (`income_basis_year`, 2027-28), not by that year's own
 * income, so an income band holds the same households in every year. The
 * page draws a fixed set of dots per income band (panelDots), so following
 * a dot from year to year follows the same group of households.
 */

import { fiscalYearLabel } from "./publication/format";
import { buildChartCsv } from "./chartCsv";
import { chooseSelectionReform, selectionNotPublished } from "./geography/selection";
import {
  bandLabel,
  changeBandLabel as describeChangeBand,
  changeBandMiddle,
  changeKind,
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
  "income_basis_year",
];
const NUMERIC = new Set([
  "year",
  "income_band",
  "change_band",
  "change_band_upper",
  "households",
  "income_basis_year",
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
 *   households: number, income_basis_year: number}>}
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

/** The scatter's notice when the selection's combined run is not published. */
export const SCATTER_SELECTION_NOT_PUBLISHED = selectionNotPublished("Household");

/**
 * What the scatter can show for the header's selection.
 *
 * @param {Object} options
 * @param {{status: "loading"|"ready"|"unavailable"|"error",
 *   rows: Array<Object>|null}} options.data
 * @param {Array<string>} options.selectedIds
 * @param {Array<string>} options.policyIds - Every measure the page offers.
 * @param {string|null} [options.packageKey] - The published combined run
 *   of exactly the selected policies (selectionPackageKey), or null.
 * @param {number} options.year
 * @returns {{kind: "loading"} | {kind: "notice", reason: string,
 *   detail: string|null} | {kind: "points", reform: string,
 *   points: Array<Object>, basisYear: number, basisPoints: Array<Object>}}
 *   `points` are the year's cells; `basisPoints` the basis year's, which
 *   set how many dots each income band gets in every year.
 */
export function scatterView({ data, selectedIds, policyIds, year, packageKey = null }) {
  if (data.status === "loading") return { kind: "loading" };
  if (data.status !== "ready") {
    return notice("We have not yet published household results.");
  }
  const reforms = [...new Set(data.rows.map((row) => row.reform_id))];
  const choice = chooseSelectionReform({
    selectedIds,
    policyIds,
    reforms,
    packageKey,
    reason: SCATTER_SELECTION_NOT_PUBLISHED,
  });
  if (choice.kind === "none") {
    return notice("Select a policy to see household results.");
  }
  if (choice.kind === "no-package") {
    return notice(choice.reason);
  }
  if (!reforms.includes(choice.reform)) {
    return notice("We have not yet published household results for this policy.");
  }
  const bins = SCATTER_BINS;
  const cellsIn = (wanted) =>
    data.rows
      // A cell whose count rounds to nothing has no dot to draw.
      .filter(
        (row) =>
          row.reform_id === choice.reform && row.year === wanted && row.households > 0,
      )
      .map((row) => ({
        income: row.income_band + bins.income_band_width / 2,
        change: changeBandMiddle(row.change_band, row.change_band_upper),
        households: row.households,
        incomeBand: row.income_band,
        changeBand: row.change_band,
        changeBandUpper: row.change_band_upper,
      }));
  const points = cellsIn(year);
  // A combined run that shows no change while one of its policies' own runs
  // moves households that year is not the selection's result: say the
  // combination is not published, never that nothing changes
  const moves = (row) => row.year === year && row.households > 0 && changeKind(row.change_band, row.change_band_upper) !== "zero";
  if (
    choice.kind === "package" &&
    points.length > 0 &&
    !data.rows.some((row) => row.reform_id === choice.reform && moves(row)) &&
    data.rows.some((row) => choice.members.includes(row.reform_id) && moves(row))
  ) {
    return notice(SCATTER_SELECTION_NOT_PUBLISHED);
  }
  if (points.length === 0) {
    return notice(
      `We publish no household results for this policy in ${fiscalYearLabel(year)}.`,
    );
  }
  const basisYear = data.rows.find(
    (row) => row.reform_id === choice.reform,
  ).income_basis_year;
  const basisPoints = cellsIn(basisYear);
  // Every year's cells for this selection, so the change axis can be fitted
  // once across years and stay put while the year changes
  const years = [
    ...new Set(data.rows.filter((row) => row.reform_id === choice.reform).map((row) => row.year)),
  ].sort((a, b) => a - b);
  return {
    kind: "points",
    reform: choice.reform,
    points,
    yearPoints: years.map(cellsIn).filter((cells) => cells.length > 0),
    basisYear,
    // Without the basis year's cells, the year's own share out the dots
    basisPoints: basisPoints.length > 0 ? basisPoints : points,
  };
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
export function scatterCsv(points, { title, basisYear }) {
  const basis = basisYear ? ` in ${fiscalYearLabel(basisYear)}` : "";
  return buildChartCsv({
    title,
    units: `£ a year (bands of baseline household net income${basis} and of the change in the year's net income); households (weighted, rounded to the nearest 1,000)`,
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
      ...(basisYear
        ? [
            `We group households by their baseline net income in ${fiscalYearLabel(basisYear)} in every year, so an income band holds the same households in each year.`,
          ]
        : []),
      `We leave out groups with fewer than ${SCATTER_BINS.min_households} surveyed households; the outer bands include everything beyond them.`,
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

/**
 * The widest change axis: ±£5,000, the 2025 dashboard's fixed axis. The
 * axis drawn is fitted to the dots (fitChangeAxis) and never wider.
 */
export const CHANGE_AXIS_DOMAIN = [-5000, 5000];

// Tick steps the fitted change axis may use, in £
const CHANGE_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500];
// Room past the farthest dot on each side, as a share of its reach, so no
// dot is drawn on the axis edge
const CHANGE_PAD = 0.05;
// A side is cut short only when a few far changes would squash the rest:
// its farthest dot is more than CHANGE_CAP_RATIO times the side's
// CHANGE_CAP_QUANTILE percentile. It then stops at that percentile, and the
// dots beyond are drawn as arrows at the edge (`clamped`).
export const CHANGE_CAP_QUANTILE = 0.98;
const CHANGE_CAP_RATIO = 2;
// Fewer dots than this on a side: always show them all
const CHANGE_CAP_MIN_DOTS = 20;

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at];
}

/** How far one side of the axis reaches: from its dots' sizes, ascending. */
function sideReach(sizes) {
  if (sizes.length === 0) return { reach: 0, capped: false };
  const farthest = sizes[sizes.length - 1];
  const percentile = quantile(sizes, CHANGE_CAP_QUANTILE);
  const squashed =
    sizes.length >= CHANGE_CAP_MIN_DOTS && percentile > 0 && farthest > CHANGE_CAP_RATIO * percentile;
  const reach = Math.min(squashed ? percentile : farthest, CHANGE_AXIS_DOMAIN[1]);
  return { reach, capped: farthest > reach };
}

/**
 * The change axis fitted to the dots shown: each side reaches past its
 * farthest dot by a little room (CHANGE_PAD), always including £0, rounded
 * out to a tick step chosen for about four to six ticks, and never wider
 * than ±£5,000, so no dot is drawn on the axis edge. Only when a few far
 * changes would squash the rest does a side stop short, at the 98th
 * percentile of that side's dots; clampToAxis then draws the dots beyond
 * (and those in the open-ended bands past ±£5,000) as arrows at the edge.
 * A side with no dots gets half a step of room, so dots at zero are not cut.
 *
 * @param {Array<{change: number, hidden?: boolean, edge?: string}>} dots
 * @returns {{domain: [number, number], ticks: number[],
 *   capped: {low: boolean, high: boolean}}}
 */
export function fitChangeAxis(dots) {
  const shown = dots.filter((dot) => !dot.hidden || dot.edge);
  const finite = shown.filter((dot) => !dot.edge).map((dot) => dot.change);
  const losses = finite.filter((change) => change < 0).map((change) => -change).sort((a, b) => a - b);
  const gains = finite.filter((change) => change > 0).sort((a, b) => a - b);
  const low = sideReach(losses);
  const high = sideReach(gains);
  const lowEdge = shown.some((dot) => dot.edge === "lower");
  const highEdge = shown.some((dot) => dot.edge === "upper");
  // An open-ended band's dots lie past ±£5,000: with no other dots on that
  // side, the side reaches its limit
  const lowReach = lowEdge && low.reach === 0 ? CHANGE_AXIS_DOMAIN[1] : low.reach;
  const highReach = highEdge && high.reach === 0 ? CHANGE_AXIS_DOMAIN[1] : high.reach;
  const lowData = -Math.min(lowReach * (1 + CHANGE_PAD), CHANGE_AXIS_DOMAIN[1]);
  const highData = Math.min(highReach * (1 + CHANGE_PAD), CHANGE_AXIS_DOMAIN[1]);
  const range = Math.max(highData - lowData, CHANGE_STEPS[0]);
  const step = CHANGE_STEPS.find((s) => range / s <= 5) ?? CHANGE_STEPS[CHANGE_STEPS.length - 1];
  const lowTick = Math.max(CHANGE_AXIS_DOMAIN[0], Math.floor(lowData / step) * step);
  const highTick = Math.min(CHANGE_AXIS_DOMAIN[1], Math.ceil(highData / step) * step);
  const ticks = [];
  for (let t = lowTick; t <= highTick + 1e-9; t += step) ticks.push(Math.round(t));
  return {
    domain: [lowTick === 0 ? -step / 2 : lowTick, highTick === 0 ? step / 2 : highTick],
    ticks,
    capped: { low: low.capped || lowEdge, high: high.capped || highEdge },
  };
}

/**
 * The change axis for a selection, fitted once across all its years: the
 * dots of every year (each placed as panelDots places them) pooled, then
 * fitChangeAxis. Kept while the year changes, so dots slide on one scale.
 */
export function fitChangeAxisAcrossYears(basisCells, yearCells) {
  const pooled = yearCells.flatMap((cells) => panelDots(basisCells, cells));
  return fitChangeAxis(pooled);
}

/**
 * Dots beyond the fitted axis, and dots in the open-ended bands past
 * ±£5,000, placed at the axis edge and marked `clamped` (drawn as an arrow
 * pointing out, and said so in the tooltip), so every group stays on the
 * plot without one far change setting the scale for all. Every other dot
 * sits strictly inside the axis.
 */
export function clampToAxis(dots, [low, high]) {
  return dots.map((dot) => {
    if (dot.hidden && !dot.edge) return dot;
    if (dot.edge) {
      return { ...dot, hidden: false, clamped: true, change: dot.edge === "upper" ? high : low };
    }
    if (dot.change < low) return { ...dot, clamped: true, change: low };
    if (dot.change > high) return { ...dot, clamped: true, change: high };
    return dot;
  });
}

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

/** The cells of each income band, in change order (losses first). */
function byIncomeBand(cells) {
  const rows = new Map();
  for (const cell of cells) {
    if (!rows.has(cell.incomeBand)) rows.set(cell.incomeBand, []);
    rows.get(cell.incomeBand).push(cell);
  }
  for (const row of rows.values()) {
    row.sort(
      (a, b) => a.changeBand - b.changeBand || a.changeBandUpper - b.changeBandUpper,
    );
  }
  return rows;
}

// Where a dot whose change band is open-ended, or whose group has no
// published cells this year, waits: just beyond the change axis, unseen.
const OFF_PLOT = 5600;

/**
 * The cloud as a panel of dots that keep their groups across years.
 *
 * Every income band is a fixed group of households: those whose baseline
 * net income in the basis year falls in it (the generator bands every
 * year's households by that year's income). The band gets its share of
 * `total` dots once, by its households in the basis year (`basisCells`),
 * so it has the same dots in every year. Its k-th of n dots stands at the
 * (k + ½)/n weighted quantile of the band's change distribution in the
 * year shown (`cells`): the dot finds the change band holding that
 * quantile, and its place inside that band is set by how far into the
 * band's households the quantile falls, blended with a fixed jitter of its
 * own. Its income, within its band, never changes. So from year to year a
 * dot stays in its row, moves only sideways, and keeps its rank within the
 * group: as last year's 500 sampled households did, but as groups.
 *
 * Dots whose quantile falls in an open-ended band beyond ±£5,000, or whose
 * band has no published cell in the year (all were too small), are kept
 * but hidden, so each dot keeps its identity and can come back.
 *
 * @param {Array<Object>} basisCells - The basis year's cells.
 * @param {Array<Object>} cells - The year's cells.
 * @returns {Array<Object>} one dot per (income band, k), in a fixed order,
 *   with `key`, `income`, `change`, `hidden` and the cell it sits in
 *   (`changeBand`, `changeBandUpper`, `households`).
 */
export function panelDots(
  basisCells,
  cells,
  { total = SCATTER_DOTS, bins = SCATTER_BINS } = {},
) {
  const basisRows = [...byIncomeBand(basisCells).entries()]
    .sort(([a], [b]) => a - b)
    .map(([incomeBand, row]) => ({
      incomeBand,
      changeBand: 0,
      changeBandUpper: 0,
      households: row.reduce((sum, cell) => sum + cell.households, 0),
    }));
  const counts = allocateDots(basisRows, total);
  const yearRows = byIncomeBand(cells);
  const dots = [];
  basisRows.forEach(({ incomeBand }, index) => {
    const n = counts[index];
    const row = yearRows.get(incomeBand) ?? [];
    const weight = row.reduce((sum, cell) => sum + cell.households, 0);
    const incomeWidth = Math.min(bins.income_band_width, bins.income_max - incomeBand);
    for (let k = 0; k < n; k += 1) {
      const random = seeded(hash(`${incomeBand}:${k}`));
      const income = incomeBand + random() * incomeWidth;
      const jitter = random();
      const key = `${incomeBand}:${k}`;
      if (!(weight > 0)) {
        dots.push({ key, income, change: 0, hidden: true, incomeBand, changeBand: -1, changeBandUpper: 1, households: 0 });
        continue;
      }
      const target = ((k + 0.5) / n) * weight;
      let before = 0;
      let cell = row[row.length - 1];
      for (const candidate of row) {
        if (target < before + candidate.households) {
          cell = candidate;
          break;
        }
        before += candidate.households;
      }
      const into = Math.min(1, Math.max(0, (target - before) / cell.households));
      const edge = edgeOf(cell.changeBand, cell.changeBandUpper);
      const change = edge
        ? (edge === "upper" ? 1 : -1) * OFF_PLOT
        : cell.changeBand +
          ((into + jitter) / 2) * (cell.changeBandUpper - cell.changeBand);
      dots.push({
        key,
        income,
        change,
        hidden: Boolean(edge),
        edge: edge || undefined,
        incomeBand,
        changeBand: cell.changeBand,
        changeBandUpper: cell.changeBandUpper,
        households: cell.households,
      });
    }
  });
  return dots;
}

/**
 * How households with income like one household's changed: the cells of
 * the income bands whose middle is within `window` of `income` (two £5,000
 * bands), and the change bands that hold their middle `share` of
 * households (by weighted count, from the 10th to the 90th percentile by
 * default). The range is the outer edges of those two change bands, so at
 * least `share` of the band's published households fall inside it.
 *
 * Null when there is nothing honest to say: the income is off the
 * published bands, no cells fall in them, or the range reaches an
 * open-ended band beyond ±£5,000.
 *
 * @param {Array<{incomeBand: number, changeBand: number,
 *   changeBandUpper: number, households: number}>} cells - The year's cells.
 * @param {number} income - The household's income on the scatter's basis.
 * @returns {{incomeLow: number, incomeHigh: number, low: number,
 *   high: number, share: number} | null} `low` and `high` in £ a year
 *   (the no-change band counts as £0).
 */
export function incomeLikeYours(
  cells,
  income,
  { window = 5000, share = 0.8, bins = SCATTER_BINS } = {},
) {
  if (!Number.isFinite(income) || income < bins.income_min || income >= bins.income_max) {
    return null;
  }
  const width = bins.income_band_width;
  const near = cells.filter(
    (cell) => Math.abs(cell.incomeBand + width / 2 - income) <= window && cell.households > 0,
  );
  const total = near.reduce((sum, cell) => sum + cell.households, 0);
  if (!(total > 0)) return null;
  const sorted = [...near].sort(
    (a, b) => a.changeBand - b.changeBand || a.changeBandUpper - b.changeBandUpper,
  );
  // Merge cells of the same change band across the income bands
  const bands = [];
  for (const cell of sorted) {
    const last = bands[bands.length - 1];
    if (last && last.changeBand === cell.changeBand && last.changeBandUpper === cell.changeBandUpper) {
      last.households += cell.households;
    } else {
      bands.push({ ...cell });
    }
  }
  const at = (q) => {
    const target = q * total;
    let before = 0;
    for (const band of bands) {
      before += band.households;
      if (before > target) return band;
    }
    return bands[bands.length - 1];
  };
  const tail = (1 - share) / 2;
  const lowBand = at(tail);
  const highBand = at(1 - tail);
  if (openEdge(lowBand.changeBand, lowBand.changeBandUpper)) return null;
  if (openEdge(highBand.changeBand, highBand.changeBandUpper)) return null;
  // The no-change band (−£1, £1) counts as £0 at either end
  const edge = (value) => (Math.abs(value) <= 1 ? 0 : value);
  const incomeBands = near.map((cell) => cell.incomeBand);
  return {
    incomeLow: Math.min(...incomeBands),
    incomeHigh: Math.min(Math.max(...incomeBands) + width, bins.income_max),
    low: edge(lowBand.changeBand),
    high: edge(highBand.changeBandUpper),
    share,
  };
}
