/**
 * A strict reader for the published tables.
 *
 * The Python side writes each table with fixed columns and types
 * (`uk_budget_data.publication.tables`). This reader accepts exactly those:
 * the header must be the table's columns in order, and every cell must parse
 * as its declared type. A value that is missing, not a number or not finite
 * is an error, never a zero.
 */

import contract from "./contract.json";

export const TABLES = contract.tables;

/** Raised when a table's text is not what the publication format allows. */
export class TableError extends Error {
  constructor(message) {
    super(message);
    this.name = "TableError";
  }
}

/**
 * Split CSV text into rows of string cells (RFC 4180: quoted fields, doubled
 * quotes, embedded commas and line breaks, LF or CRLF line endings).
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let cellWasQuoted = false;
  let index = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
    cellWasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (cell !== "" || cellWasQuoted) {
        throw new TableError(`unexpected quote at character ${index}`);
      }
      quoted = true;
      cellWasQuoted = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r" && text[index + 1] === "\n") {
      endRow();
      index += 1;
    } else {
      if (cellWasQuoted) {
        throw new TableError(
          `text after a closing quote at character ${index}`,
        );
      }
      cell += char;
    }
    index += 1;
  }
  if (quoted) throw new TableError("unterminated quoted field");
  // A final line with no line ending is still a row.
  if (cell !== "" || cellWasQuoted || row.length > 0) endRow();
  return rows;
}

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function typed(text, kind, where) {
  if (kind === "str") return text;
  if (kind === "bool") {
    if (text === "True") return true;
    if (text === "False") return false;
    throw new TableError(`${where}: ${JSON.stringify(text)} is not a boolean`);
  }
  if (kind === "int") {
    const number = Number(text);
    if (!INTEGER.test(text) || !Number.isSafeInteger(number)) {
      throw new TableError(
        `${where}: ${JSON.stringify(text)} is not an integer`,
      );
    }
    return number;
  }
  const number = Number(text);
  if (!DECIMAL.test(text) || !Number.isFinite(number)) {
    throw new TableError(`${where}: ${JSON.stringify(text)} is not a number`);
  }
  // A non-zero figure that underflows to zero would read as no effect.
  if (number === 0 && /[1-9]/.test(text.split(/[eE]/)[0])) {
    throw new TableError(
      `${where}: ${JSON.stringify(text)} underflows to zero`,
    );
  }
  return number;
}

/**
 * Parse one published table into typed rows.
 *
 * @param {string} name - A table name from the publication format.
 * @param {string} text - The file's text.
 * @param {Array<[string, string]>} [columns] - The columns to expect; the
 *   contract's by default (parseFlatTable passes a flat file's wider set).
 * @returns {Array<Object>} One object per row, keyed by column.
 * @throws {TableError}
 */
export function parseTable(name, text, columns = TABLES[name]?.columns) {
  if (!Object.hasOwn(TABLES, name)) {
    throw new TableError(`${name} is not a published table`);
  }
  const [header, ...lines] = parseCsv(text);
  const expected = columns.map(([column]) => column);
  if (!header || header.join(",") !== expected.join(",")) {
    throw new TableError(
      `${name}: columns are ${JSON.stringify(header ?? [])}, ` +
        `not ${JSON.stringify(expected)}`,
    );
  }
  return lines.map((cells, line) => {
    if (cells.length !== columns.length) {
      throw new TableError(
        `${name} row ${line + 1}: ${cells.length} cells, ` +
          `not ${columns.length}`,
      );
    }
    return Object.fromEntries(
      columns.map(([column, kind], position) => [
        column,
        typed(cells[position], kind, `${name} row ${line + 1}, ${column}`),
      ]),
    );
  });
}

/**
 * Columns a flat file under public/data carries after its contract columns.
 * metrics.csv adds the poverty and inequality measures the summary charts
 * choose between (uk_budget_data.calculators: POVERTY_MEASURES, POVERTY_GROUPS
 * and inequality_changes). Receipted artifacts keep the contract's columns
 * only, so parseTable never accepts these.
 */
const POVERTY_COLUMNS = ["abs_bhc", "abs_ahc", "rel_bhc", "rel_ahc"].flatMap((measure) =>
  ["", "child_"].flatMap((group) => [
    [`${group}poverty_${measure}_change_pp`, "float"],
    [`${group}poverty_${measure}_change_pct`, "float"],
  ]),
);

export const FLAT_EXTRA_COLUMNS = {
  metrics: [
    ...POVERTY_COLUMNS,
    ["top_10_share_change_pp", "float"],
    ["top_1_share_change_pp", "float"],
    ["p90_p10_change", "float"],
  ],
};

/**
 * Parse a flat file under public/data: the contract's columns, then either
 * none or all of the table's FLAT_EXTRA_COLUMNS, in order and typed. An
 * older file without the extras still parses.
 *
 * @param {string} name - A table name from the publication format.
 * @param {string} text - The file's text.
 * @returns {Array<Object>} One object per row, keyed by column.
 * @throws {TableError}
 */
export function parseFlatTable(name, text) {
  const extras = FLAT_EXTRA_COLUMNS[name] ?? [];
  const [header] = parseCsv(text);
  const contracted = Object.hasOwn(TABLES, name) ? TABLES[name].columns.length : 0;
  if (!extras.length || !header || header.length === contracted) {
    return parseTable(name, text);
  }
  return parseTable(name, text, [...TABLES[name].columns, ...extras]);
}

/** The table name for a published file name, or null. */
export function tableForFile(fileName) {
  const match = Object.entries(TABLES).find(
    ([, table]) => table.file === fileName,
  );
  return match ? match[0] : null;
}
