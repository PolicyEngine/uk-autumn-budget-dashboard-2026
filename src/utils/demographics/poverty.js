/**
 * A strict reader for poverty_by_age.csv: the share of people in each of
 * policyengine.py's age groups in absolute poverty before housing costs,
 * without and with each reform, in per cent, and the change in percentage
 * points. Rates only, never counts.
 *
 * As with results by area, the page shows these figures only as published:
 * a file that breaks a rule is rejected whole, a blank is never read as
 * zero, and error messages name rows and columns, never a figure.
 */

import { parseCsv } from "../publication/csv";
import { compareDecimal, isDecimal } from "../geography/decimal";
import { REFORM, YEAR, quoted } from "../geography/parse";
import { AGE_GROUP, GROUPS } from "./groups";

export const POVERTY_FILE = "poverty_by_age.csv";

/** The columns, in the order the pipeline writes them. */
export const POVERTY_COLUMNS = Object.freeze([
  "reform",
  "year",
  "age_group",
  "baseline_rate",
  "reform_rate",
  "change_pp",
]);

const AGE_GROUPS = GROUPS[AGE_GROUP].map((group) => group.code);
const RATES = ["baseline_rate", "reform_rate"];
// The pipeline rounds both rates and the change to two decimal places
// separately, so the change may differ from the rates' difference by up
// to three half-hundredths.
const ROUNDING = 0.015 + 1e-9;

/** Raised when a file is not in the published format. */
export class PovertyTableError extends Error {
  constructor(message) {
    super(message);
    this.name = "PovertyTableError";
  }
}

function checkHeader(header) {
  const problem = (detail) =>
    new PovertyTableError(
      `the columns are not the published ones (${detail}); ` +
        `expected ${POVERTY_COLUMNS.join(",")}`,
    );
  if (!header || header.length === 0) throw problem("no header");
  if (new Set(header).size !== header.length) throw problem("a repeated column");
  const missing = POVERTY_COLUMNS.filter((column) => !header.includes(column));
  const extra = header.filter((column) => !POVERTY_COLUMNS.includes(column));
  const parts = [];
  if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
  if (extra.length > 0) parts.push(`unexpected ${extra.map(quoted).join(", ")}`);
  if (parts.length > 0) throw problem(parts.join("; "));
}

function readRow(cells, where) {
  if (!REFORM.test(cells.reform)) {
    throw new PovertyTableError(`${where}: reform is not an identifier`);
  }
  if (!YEAR.test(cells.year)) {
    throw new PovertyTableError(`${where}: year is not a year`);
  }
  if (!AGE_GROUPS.includes(cells.age_group)) {
    throw new PovertyTableError(
      `${where}: age_group ${quoted(cells.age_group)} is not one of ${AGE_GROUPS.join(", ")}`,
    );
  }
  for (const column of [...RATES, "change_pp"]) {
    if (!isDecimal(cells[column])) {
      throw new PovertyTableError(`${where}: ${column} is not a number`);
    }
  }
  for (const column of RATES) {
    if (
      compareDecimal(cells[column], "0") < 0 ||
      compareDecimal(cells[column], "100") > 0
    ) {
      throw new PovertyTableError(`${where}: ${column} is not between 0 and 100`);
    }
  }
  const difference =
    Number(cells.reform_rate) - Number(cells.baseline_rate) - Number(cells.change_pp);
  if (Math.abs(difference) > ROUNDING) {
    throw new PovertyTableError(
      `${where}: change_pp is not reform_rate minus baseline_rate`,
    );
  }
  return Object.freeze({
    cells: Object.freeze(cells),
    reform: cells.reform,
    year: Number(cells.year),
    ageGroup: cells.age_group,
    baselineRate: cells.baseline_rate,
    reformRate: cells.reform_rate,
    changePp: cells.change_pp,
  });
}

/**
 * Parse poverty_by_age.csv.
 *
 * @param {string} text - The file's text (UTF-8, RFC 4180).
 * @returns {{rows: Array<Object>, byReform: Map, reforms: Array<string>}}
 *   The rows, each with its published strings, indexed by reform (so the
 *   helpers in geography/rows.js read it too).
 * @throws {PovertyTableError} naming the first rule a row breaks.
 */
export function parsePovertyTable(text) {
  let records;
  try {
    records = parseCsv(text);
  } catch (error) {
    throw new PovertyTableError(`not valid CSV: ${error.message}`);
  }
  const [header, ...lines] = records;
  checkHeader(header);
  const seen = new Set();
  const byReform = new Map();
  const rows = lines.map((values, position) => {
    const where = `row ${position + 1}`;
    if (values.length !== header.length) {
      throw new PovertyTableError(
        `${where}: ${values.length} cells, not ${header.length}`,
      );
    }
    const cells = Object.fromEntries(
      POVERTY_COLUMNS.map((column) => [column, values[header.indexOf(column)]]),
    );
    const row = readRow(cells, where);
    const key = JSON.stringify([row.reform, row.year, row.ageGroup]);
    if (seen.has(key)) {
      throw new PovertyTableError(
        `${where}: a second row for ${row.reform}, ${row.year}, ${row.ageGroup}`,
      );
    }
    seen.add(key);
    if (!byReform.has(row.reform)) byReform.set(row.reform, []);
    byReform.get(row.reform).push(row);
    return row;
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    byReform,
    reforms: Object.freeze([...byReform.keys()].sort()),
  });
}
