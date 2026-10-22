/**
 * Which lifetime-model series the selected population policies cover, and
 * the totals of those series alone.
 */
import {
  LIFECYCLE_COMBINED,
  LIFECYCLE_KEY_BY_POLICY,
  LIFECYCLE_REFORMS,
} from "./policyConfig";

/**
 * @param {string[]} selectedIds - Selected population policy ids
 * @param {Array<{id: string, name: string}>} policies - All population policies
 * @returns {{reforms: Array, partialCombined: boolean, unmodelled: string[]}}
 *   The lifecycle series to show (in legend order); whether only some of the
 *   combined series' policies are selected (so it is left out); and the
 *   selected policies the lifetime model does not cover.
 */
export function lifecycleSelection(selectedIds, policies = []) {
  const selected = new Set(selectedIds);
  const keys = new Set();
  const unmodelled = [];
  selectedIds.forEach((id) => {
    if (LIFECYCLE_KEY_BY_POLICY[id]) keys.add(LIFECYCLE_KEY_BY_POLICY[id]);
    else if (!LIFECYCLE_COMBINED.policies.includes(id)) {
      unmodelled.push(policies.find((policy) => policy.id === id)?.name ?? id);
    }
  });
  const combinedCount = LIFECYCLE_COMBINED.policies.filter((id) => selected.has(id)).length;
  if (combinedCount === LIFECYCLE_COMBINED.policies.length) keys.add(LIFECYCLE_COMBINED.key);
  return {
    reforms: LIFECYCLE_REFORMS.filter((reform) => keys.has(reform.key)),
    partialCombined: combinedCount > 0 && combinedCount < LIFECYCLE_COMBINED.policies.length,
    unmodelled,
  };
}

/** Net lifetime total and average a year over the given series only. */
export function lifecycleTotals(rows, reforms) {
  if (!rows.length || !reforms.length) return { netTotal: 0, avgPerYear: 0 };
  const netTotal = rows.reduce(
    (sum, row) => sum + reforms.reduce((rowSum, r) => rowSum + (row[r.key] || 0), 0),
    0,
  );
  return { netTotal, avgPerYear: netTotal / rows.length };
}
