/**
 * Budget day (#105): is the package total the combined run, or the sum of
 * the measures?
 *
 * Measures interact, so the combined run (one simulation of every live
 * measure) is the true total. publish-measure puts each measure live on
 * its own; refresh-combined reruns the combined run in batches. In
 * between, the combined run's rows are stale and the page shows the sum of
 * the measures, labelled as such.
 *
 * The combined run's budgetary rows name their members in
 * `reform_members` (ids joined by "+"). It is current exactly when those
 * members are the live measures: the single measures in
 * budgetary_impact.csv. publish-measure blanks the cell when it changes a
 * member's rows, and a newly published measure is not a member, so either
 * makes it stale. A file without the column predates this flow (before the
 * first full run that writes it): its totals stay the unlabelled sums the
 * page has always shown.
 */
import { COMBINED_REFORM_ID } from "./policyConfig";

export const SUM_OF_MEASURES = "Sum of measures";

const isCombined = (id) => typeof id === "string" && id.endsWith("_combined");

/** The single measures the file publishes, in file order. */
export function liveMeasureIds(budgetaryRows) {
  const ids = [];
  for (const row of budgetaryRows ?? []) {
    const id = row.reform_id;
    if (id && !isCombined(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The combined run's members, or null when the file does not name them. */
export function combinedMembers(budgetaryRows, combinedId = COMBINED_REFORM_ID) {
  const row = (budgetaryRows ?? []).find(
    (item) => item.reform_id === combinedId && item.reform_members,
  );
  return row ? row.reform_members.split("+") : null;
}

/** Whether the combined run covers exactly the live measures. */
export function isCombinedCurrent(budgetaryRows, combinedId = COMBINED_REFORM_ID) {
  const members = combinedMembers(budgetaryRows, combinedId);
  const live = liveMeasureIds(budgetaryRows);
  return (
    members !== null &&
    members.length === live.length &&
    live.every((id) => members.includes(id))
  );
}

/**
 * Where the total for a selection comes from:
 * - "combined": every live measure is selected and the combined run is
 *   current, so the total is the combined run's;
 * - "sum-stale": every live measure is selected but the combined run is
 *   stale, so the total is the sum of the measures, labelled so;
 * - "sum": some measures are selected, or the file predates the members
 *   column; the total is their sum, unlabelled, as ever;
 * - "single" or "none".
 */
export function totalSource(budgetaryRows, selected, combinedId = COMBINED_REFORM_ID) {
  if (!selected?.length) return "none";
  if (selected.length === 1) return "single";
  const live = liveMeasureIds(budgetaryRows);
  const everyLive = live.length > 1 && live.every((id) => selected.includes(id));
  if (!everyLive) return "sum";
  const named = (budgetaryRows ?? []).some((row) => row.reform_members !== undefined);
  if (!named) return "sum";
  return isCombinedCurrent(budgetaryRows, combinedId) ? "combined" : "sum-stale";
}

/** The combined run's value for a year, or null if it has none. */
export function combinedValue(budgetaryRows, year, combinedId = COMBINED_REFORM_ID) {
  const row = (budgetaryRows ?? []).find(
    (item) => item.reform_id === combinedId && Number(item.year) === Number(year),
  );
  const value = row ? Number(row.value) : NaN;
  return row && row.value !== "" && Number.isFinite(value) ? value : null;
}
