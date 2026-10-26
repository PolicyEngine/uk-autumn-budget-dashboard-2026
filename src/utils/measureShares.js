// Better and worse off when the selection has no single run: one row per
// selected measure, each measure's own published shares for one group (an
// age group, or pensioners). Shares come from separate simulations, so
// they are never added up across measures; with one run for the whole
// selection (one measure, or a published combined run that matches it) the
// cards draw that run's groups as before.

import { wholeSelectionRun } from "./ageImpact";
import { shortNameOf } from "./policyDetails";

/**
 * The per-measure view, or null when the selection has its own run.
 *
 * @param {Function} sharesFn - (rows, policies, [id], year) => {groups} | null
 * @param {string} groupKey - The group shown (e.g. "16_24", "pensioners")
 * @returns {null | {groups: Array<{key, label}>, rows: Array<{id, name, row}>, missing: string[]}}
 *   groups: the groups a measure's shares offer, for the group choice;
 *   rows: one per selected measure with a usable row for the group, in the
 *   catalogue's order; missing: names of measures without one.
 */
export function sharesByMeasure(sharesFn, rows, policies, selected, year, combinedId, groupKey) {
  if (selected.length < 2) return null;
  if (wholeSelectionRun(policies, selected, combinedId)) return null;
  const chosen = policies.filter((policy) => selected.includes(policy.id) && policy.displayable !== false);
  let groups = [];
  const out = [];
  const missing = [];
  for (const policy of chosen) {
    const shares = sharesFn(rows, policies, [policy.id], year);
    if (shares && !groups.length) groups = shares.groups.map(({ key, label }) => ({ key, label }));
    const group = shares?.groups.find((candidate) => candidate.key === groupKey);
    const name = shortNameOf(policy);
    if (group && group.row && !group.suppressed) out.push({ id: policy.id, name, row: group.row });
    else missing.push(name);
  }
  return { groups, rows: out, missing };
}
