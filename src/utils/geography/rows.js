/**
 * An index of results by area or group: one row per level, area, reform,
 * year and outcome. Lookups return the published row or null, never a
 * stand-in.
 */

function keyOf(level, areaCode, reform, year, outcome) {
  return JSON.stringify([level, areaCode, reform, year, outcome]);
}

/**
 * Index parsed rows of one level or several.
 *
 * @param {string|Array<string>} levels
 * @throws {Error} when two rows share a key.
 */
export function indexRows(levels, rows) {
  const levelList = Object.freeze([levels].flat());
  const byKey = new Map();
  const byReform = new Map();
  rows.forEach((row, position) => {
    const key = keyOf(row.level, row.areaCode, row.reform, row.year, row.outcome);
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
    // The file's one level, or null for a file of several
    level: levelList.length === 1 ? levelList[0] : null,
    levels: levelList,
    rows: Object.freeze(rows),
    byKey,
    byReform,
    reforms: Object.freeze([...byReform.keys()].sort()),
  });
}

/**
 * The row for one area, reform, year and outcome, or null. `level` is the
 * table's own unless given (a file of several levels needs it).
 */
export function lookupRow(
  table,
  { level = table?.level, areaCode, reform, year, outcome },
) {
  if (!table) return null;
  return (
    table.byKey.get(keyOf(level, areaCode, reform, year, outcome)) ?? null
  );
}

/** Whether the table publishes anything for `reform`. */
export const hasReform = (table, reform) =>
  Boolean(table) && table.byReform.has(reform);

/**
 * The rows for one reform, year and outcome (every outcome when it is not
 * given), of one level when `level` is given, in file order.
 */
export function rowsFor(table, { reform, year, outcome, level }) {
  if (!table || !table.byReform.has(reform)) return [];
  return table.byReform
    .get(reform)
    .filter(
      (row) =>
        row.year === year &&
        (outcome === undefined || row.outcome === outcome) &&
        (level === undefined || row.level === level),
    );
}

/** The years the table publishes for `reform`, ascending. */
export function yearsFor(table, reform) {
  if (!table || !table.byReform.has(reform)) return [];
  return [...new Set(table.byReform.get(reform).map((row) => row.year))].sort(
    (a, b) => a - b,
  );
}
