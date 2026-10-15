/**
 * A strict reader for results by area (regional.csv, constituency.csv).
 *
 * The page shows these figures only as the disclosure layer published them,
 * so it accepts a file only when every row keeps the format's rules, and
 * otherwise rejects the whole file: half a table, or a table read by
 * guesswork, could show a figure that was never published. In particular
 * a blank is never read as zero, and a withheld row that carries a figure
 * makes the file invalid.
 *
 * Error messages name rows and columns, never a cell's figure.
 */

import { parseCsv } from "../publication/csv";
import {
  COLUMNS,
  DIRECTIONS,
  ESTIMATORS,
  FIGURE_COLUMNS,
  NOISE_VALUES,
  OUTCOMES,
  SUPPORT_BANDS,
  TIER_REASONS,
  TIERS,
} from "./columns";
import { compareDecimal, isDecimal, signOf } from "./decimal";
import { isRegionCode } from "./regions";
import { indexRows } from "./rows";

/** Raised when a file is not in the published format. */
export class GeographyTableError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeographyTableError";
  }
}

// An ONS GSS code: a letter and eight digits.
const AREA_CODE = /^[A-Z]\d{8}$/;
const REFORM = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const YEAR = /^\d{4}$/;

// A message may quote a word from the file, shortened, but nothing with a
// digit in it: in a malformed file a figure can sit in any column, even
// the header.
const quoted = (text) =>
  /\d/.test(String(text))
    ? "(a cell with digits)"
    : JSON.stringify(String(text).slice(0, 40));

function checkHeader(header) {
  const problem = (detail) =>
    new GeographyTableError(
      `the columns are not the published ones (${detail}); ` +
        `expected ${COLUMNS.join(",")}`,
    );
  if (!header || header.length === 0) throw problem("no header");
  const seen = new Set();
  for (const column of header) {
    if (seen.has(column)) throw problem(`${quoted(column)} twice`);
    seen.add(column);
  }
  const missing = COLUMNS.filter((column) => !seen.has(column));
  const extra = header.filter((column) => !COLUMNS.includes(column));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`unexpected ${extra.map(quoted).join(", ")}`);
    throw problem(parts.join("; "));
  }
}

function oneOf(allowed, text, where, column) {
  if (!allowed.includes(text)) {
    throw new GeographyTableError(
      `${where}: ${column} ${quoted(text)} is not one of ${allowed.join(", ")}`,
    );
  }
  return text;
}

function checkFigures(cells, where) {
  for (const column of ["value", "lo", "hi"]) {
    if (!isDecimal(cells[column])) {
      throw new GeographyTableError(`${where}: ${column} is not a number`);
    }
  }
  const { value, lo, hi, direction } = cells;
  if (compareDecimal(lo, value) > 0 || compareDecimal(value, hi) > 0) {
    throw new GeographyTableError(
      `${where}: the value is not within its interval`,
    );
  }
  const [low, high] = [signOf(lo), signOf(hi)];
  const consistent = {
    gain: low >= 0,
    loss: high <= 0,
    too_close_to_call: low <= 0 && high >= 0,
    no_change: low === 0 && high === 0 && signOf(value) === 0,
  }[direction];
  if (!consistent) {
    throw new GeographyTableError(
      `${where}: direction ${quoted(direction)} does not match the interval`,
    );
  }
}

function readRow(line, number, level) {
  const where = `row ${number}`;
  const cells = Object.fromEntries(
    COLUMNS.map((column) => [column, line[column]]),
  );

  if (cells.level !== level) {
    throw new GeographyTableError(
      `${where}: level ${quoted(cells.level)} is not ${quoted(level)}`,
    );
  }
  if (!AREA_CODE.test(cells.area_code)) {
    throw new GeographyTableError(`${where}: area_code is not an ONS code`);
  }
  if (level === "region" && !isRegionCode(cells.area_code)) {
    throw new GeographyTableError(
      `${where}: area_code ${quoted(cells.area_code)} is not a UK region`,
    );
  }
  if (cells.area_name.trim() === "") {
    throw new GeographyTableError(`${where}: area_name is blank`);
  }
  if (!REFORM.test(cells.reform)) {
    throw new GeographyTableError(`${where}: reform is not an identifier`);
  }
  if (!YEAR.test(cells.year)) {
    throw new GeographyTableError(`${where}: year is not a year`);
  }
  oneOf(OUTCOMES, cells.outcome, where, "outcome");
  oneOf(TIERS, cells.tier, where, "tier");
  oneOf(ESTIMATORS, cells.estimator, where, "estimator");
  oneOf(Object.keys(NOISE_VALUES), cells.noise, where, "noise");

  const expectedReason = TIER_REASONS[cells.tier];
  if (expectedReason !== undefined && cells.reason !== expectedReason) {
    throw new GeographyTableError(
      `${where}: reason must be ${quoted(expectedReason)} for tier ${cells.tier}`,
    );
  }

  if (cells.tier === "withheld") {
    const filled = FIGURE_COLUMNS.filter((column) => cells[column] !== "");
    if (filled.length > 0) {
      throw new GeographyTableError(
        `${where}: a withheld row carries ${filled.join(", ")}`,
      );
    }
  } else {
    const blank = FIGURE_COLUMNS.filter((column) => cells[column] === "");
    if (blank.length > 0) {
      throw new GeographyTableError(
        `${where}: no ${blank.join(", ")} in a ${cells.tier} row`,
      );
    }
    oneOf(DIRECTIONS, cells.direction, where, "direction");
    oneOf(SUPPORT_BANDS, cells.support_band, where, "support_band");
    checkFigures(cells, where);
  }

  return Object.freeze({
    cells: Object.freeze(cells),
    level: cells.level,
    areaCode: cells.area_code,
    areaName: cells.area_name,
    reform: cells.reform,
    year: Number(cells.year),
    outcome: cells.outcome,
    value: cells.value,
    lo: cells.lo,
    hi: cells.hi,
    direction: cells.direction,
    tier: cells.tier,
    reason: cells.reason,
    supportBand: cells.support_band,
    noise: NOISE_VALUES[cells.noise],
    estimator: cells.estimator,
  });
}

/**
 * Parse one file of results by area.
 *
 * @param {string} text - The file's text (UTF-8, RFC 4180).
 * @param {{level: "region"|"constituency"}} options - The level the file
 *   must carry on every row.
 * @returns {{level: string, rows: Array<Object>, byKey: Map,
 *   byReform: Map, reforms: Array<string>}} The rows, each with its
 *   published strings in `cells`, and an index (see rows.js).
 * @throws {GeographyTableError} naming the first rule a row breaks.
 */
export function parseGeographyTable(text, { level }) {
  let records;
  try {
    records = parseCsv(text);
  } catch (error) {
    throw new GeographyTableError(`not valid CSV: ${error.message}`);
  }
  const [header, ...lines] = records;
  checkHeader(header);
  const rows = lines.map((cells, position) => {
    const number = position + 1;
    if (cells.length !== header.length) {
      throw new GeographyTableError(
        `row ${number}: ${cells.length} cells, not ${header.length}`,
      );
    }
    const line = Object.fromEntries(
      header.map((column, index) => [column, cells[index]]),
    );
    return readRow(line, number, level);
  });
  try {
    return indexRows(level, rows);
  } catch (error) {
    throw new GeographyTableError(error.message);
  }
}
