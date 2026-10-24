import { selectPersonalMeasures, supportsPersonalYears } from "./personalSelection";

/** Only a reviewed lifetime contract can authorize an API impact column. */
export function lifecycleSelection(selectedIds, measures = [], rows = []) {
  const years = rows.map((row) => row.year);
  const selection = selectPersonalMeasures(selectedIds, measures, years, "lifecycle", (measure) =>
    rows.length > 0 && rows.every((row) => Number.isFinite(row[measure.personal.key])),
  );
  return { reforms: selection.modelled, partialCombined: selection.partialCombined, unmodelled: selection.unmodelled };
}

/** A total is unavailable if a selected measure or any supported year is missing. */
export function lifecycleTotals(rows, reforms, complete = true) {
  if (!complete || !rows.length || !reforms.length) return { netTotal: null, avgPerYear: null };
  if (reforms.some((measure) => !supportsPersonalYears(measure, rows.map((row) => row.year), "lifecycle")) ||
      rows.some((row) => reforms.some(({ key }) => !Number.isFinite(row[key])))) {
    return { netTotal: null, avgPerYear: null };
  }
  const netTotal = rows.reduce(
    (sum, row) => sum + reforms.reduce((rowSum, { key }) => rowSum + row[key], 0),
    0,
  );
  return { netTotal, avgPerYear: netTotal / rows.length };
}
