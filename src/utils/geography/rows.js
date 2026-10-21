/**
 * An index of results by area: one row per level, area, reform, year and
 * outcome. Lookups return the published row or null, never a stand-in.
 */

function keyOf(level, areaCode, reform, year, outcome) {
  return JSON.stringify([level, areaCode, reform, year, outcome]);
}

/**
 * Index parsed rows of one level.
 *
 * @throws {Error} when two rows share a key.
 */
export function indexRows(level, rows) {
  const byKey = new Map();
  const byReform = new Map();
  rows.forEach((row, position) => {
    const key = keyOf(level, row.areaCode, row.reform, row.year, row.outcome);
    if (byKey.has(key)) {
      throw new Error(
        `row ${position + 1}: a second row for ${row.areaCode}, ` +
          `${row.reform}, ${row.year}, ${row.outcome}`,
      );
    }
    byKey.set(key, row);
    if (!byReform.has(row.reform)) byReform.set(row.reform, []);
    byReform.get(row.reform).push(row);
  });
  return Object.freeze({
    level,
    rows: Object.freeze(rows),
    byKey,
    byReform,
    reforms: Object.freeze([...byReform.keys()].sort()),
  });
}

/** The row for one area, reform, year and outcome, or null. */
export function lookupRow(table, { areaCode, reform, year, outcome }) {
  if (!table) return null;
  return (
    table.byKey.get(keyOf(table.level, areaCode, reform, year, outcome)) ??
    null
  );
}

/** Whether the table publishes anything for `reform`. */
export const hasReform = (table, reform) =>
  Boolean(table) && table.byReform.has(reform);

/** The rows for one reform, year and outcome, in file order. */
export function rowsFor(table, { reform, year, outcome }) {
  if (!table || !table.byReform.has(reform)) return [];
  return table.byReform
    .get(reform)
    .filter(
      (row) =>
        row.year === year && (outcome === undefined || row.outcome === outcome),
    );
}

/** The years the table publishes for `reform`, ascending. */
export function yearsFor(table, reform) {
  if (!table || !table.byReform.has(reform)) return [];
  return [...new Set(table.byReform.get(reform).map((row) => row.year))].sort(
    (a, b) => a - b,
  );
}
